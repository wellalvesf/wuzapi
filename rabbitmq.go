package main

import (
	"encoding/json"
	"os"
	"strings"
	"sync"

	"github.com/rabbitmq/amqp091-go"
	"github.com/rs/zerolog/log"
)

var (
	rabbitConn          *amqp091.Connection
	rabbitChannel       *amqp091.Channel
	rabbitEnabled       bool
	rabbitOnce          sync.Once
	rabbitQueue         string
	rabbitExchange      string
	rabbitExchangeType  string
	rabbitRoutingKey    string
	rabbitAllowedEvents map[string]bool
	rabbitAllowAll      bool
)

// Call this in main() or initialization
func InitRabbitMQ() {
	rabbitURL := os.Getenv("RABBITMQ_URL")
	rabbitQueue = os.Getenv("RABBITMQ_QUEUE")
	if rabbitQueue == "" {
		rabbitQueue = "whatsapp_events" // default queue
	}
	rabbitExchange = os.Getenv("RABBITMQ_EXCHANGE")
	rabbitExchangeType = os.Getenv("RABBITMQ_EXCHANGE_TYPE")
	if rabbitExchange != "" && rabbitExchangeType == "" {
		rabbitExchangeType = "topic"
	}
	rabbitRoutingKey = os.Getenv("RABBITMQ_ROUTING_KEY") // se vazio, usa o eventType

	// filtro de eventos
	events := strings.TrimSpace(os.Getenv("RABBITMQ_EVENTS"))
	if events == "" || strings.EqualFold(events, "All") {
		rabbitAllowAll = true
	} else {
		rabbitAllowedEvents = make(map[string]bool)
		for _, e := range strings.Split(events, ",") {
			t := strings.TrimSpace(e)
			if t != "" {
				rabbitAllowedEvents[t] = true
			}
		}
	}
	if rabbitURL == "" {
		rabbitEnabled = false
		log.Info().Msg("RABBITMQ_URL is not set. RabbitMQ publishing disabled.")
		return
	}
	var err error
	rabbitConn, err = amqp091.Dial(rabbitURL)
	if err != nil {
		rabbitEnabled = false
		log.Error().Err(err).Msg("Could not connect to RabbitMQ")
		return
	}
	rabbitChannel, err = rabbitConn.Channel()
	if err != nil {
		rabbitEnabled = false
		log.Error().Err(err).Msg("Could not open RabbitMQ channel")
		return
	}

	// declara exchange se informado
	if rabbitExchange != "" {
		if err := rabbitChannel.ExchangeDeclare(
			rabbitExchange,
			rabbitExchangeType,
			true,
			false,
			false,
			false,
			nil,
		); err != nil {
			rabbitEnabled = false
			log.Error().Err(err).Str("exchange", rabbitExchange).Msg("Could not declare RabbitMQ exchange")
			return
		}
		log.Info().Str("exchange", rabbitExchange).Str("type", rabbitExchangeType).Msg("RabbitMQ exchange declared")
	}
	rabbitEnabled = true
	log.Info().
		Str("queue", rabbitQueue).
		Msg("RabbitMQ connection established.")
}

// Optionally, allow overriding the queue per message
func shouldPublishEvent(eventType string) bool {
	if !rabbitEnabled {
		return false
	}
	if rabbitAllowAll {
		return true
	}
	if rabbitAllowedEvents == nil {
		return true
	}
	if rabbitAllowedEvents[eventType] || rabbitAllowedEvents["All"] {
		return true
	}
	return false
}

func PublishToRabbit(data []byte, eventType string, queueOverride ...string) error {
	if !shouldPublishEvent(eventType) {
		log.Debug().Str("event", eventType).Msg("RabbitMQ filter skipped event")
		return nil
	}

	// Se exchange informado, publica via exchange com routing key
	if rabbitExchange != "" {
		rk := rabbitRoutingKey
		if rk == "" {
			rk = eventType
		}
		err := rabbitChannel.Publish(
			rabbitExchange, // exchange
			rk,             // routing key
			false,
			false,
			amqp091.Publishing{
				ContentType: "application/json",
				Body:        data,
			},
		)
		if err != nil {
			log.Error().Err(err).Str("exchange", rabbitExchange).Str("routingKey", rk).Msg("Could not publish to RabbitMQ exchange")
		} else {
			log.Debug().Str("exchange", rabbitExchange).Str("routingKey", rk).Msg("Published message to RabbitMQ exchange")
		}
		return err
	}

	// Caso contrário, publica direto na fila (exchange default)
	queueName := rabbitQueue
	if len(queueOverride) > 0 && queueOverride[0] != "" {
		queueName = queueOverride[0]
	}
	_, err := rabbitChannel.QueueDeclare(
		queueName,
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Error().Err(err).Str("queue", queueName).Msg("Could not declare RabbitMQ queue")
		return err
	}
	err = rabbitChannel.Publish(
		"",
		queueName,
		false,
		false,
		amqp091.Publishing{ContentType: "application/json", Body: data},
	)
	if err != nil {
		log.Error().Err(err).Str("queue", queueName).Msg("Could not publish to RabbitMQ")
	} else {
		log.Debug().Str("queue", queueName).Msg("Published message to RabbitMQ")
	}
	return err
}

// Usage - like sendToGlobalWebhook
func sendToGlobalRabbit(jsonData []byte, eventType string, token string, userID string, queueName ...string) {
	if !rabbitEnabled {
		log.Debug().Msg("RabbitMQ publishing is disabled, not sending message")
		return
	}
	// Envelopa com metadados (token, userID, instanceName)
	payload := map[string]interface{}{}
	if err := json.Unmarshal(jsonData, &payload); err == nil {
		instanceName := ""
		if ui, ok := userinfocache.Get(token); ok {
			instanceName = ui.(Values).Get("Name")
		}
		payload["token"] = token
		payload["userID"] = userID
		payload["instanceName"] = instanceName
		payload["serverUrl"] = os.Getenv("SERVER_URL")
		if b, err := json.Marshal(payload); err == nil {
			jsonData = b
		}
	}

	err := PublishToRabbit(jsonData, eventType, queueName...)
	if err != nil {
		log.Error().Err(err).Msg("Failed to publish to RabbitMQ")
	}
}
