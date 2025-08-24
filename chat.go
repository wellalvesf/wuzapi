package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/jmoiron/sqlx"
	"github.com/rs/zerolog/log"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types/events"
)

// =====================================
// STRUCTS
// =====================================

type Conversation struct {
	ID              string    `json:"id" db:"id"`
	UserID          string    `json:"user_id" db:"user_id"`
	JID             string    `json:"jid" db:"jid"`
	Name            string    `json:"name" db:"name"`
	DisplayName     string    `json:"display_name" db:"display_name"`
	LastMessage     string    `json:"last_message" db:"last_message"`
	LastMessageTime time.Time `json:"last_message_time" db:"last_message_time"`
	UnreadCount     int       `json:"unread_count" db:"unread_count"`
	AvatarURL       string    `json:"avatar_url" db:"avatar_url"`
	IsGroup         bool      `json:"is_group" db:"is_group"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

type Message struct {
	ID              string    `json:"id" db:"id"`
	ConversationID  string    `json:"conversation_id" db:"conversation_id"`
	MessageID       string    `json:"message_id" db:"message_id"`
	FromJID         string    `json:"from_jid" db:"from_jid"`
	ToJID           string    `json:"to_jid" db:"to_jid"`
	FromMe          bool      `json:"from_me" db:"from_me"`
	MessageType     string    `json:"message_type" db:"message_type"`
	TextContent     string    `json:"text_content" db:"text_content"`
	MediaURL        string    `json:"media_url" db:"media_url"`
	MediaType       string    `json:"media_type" db:"media_type"`
	FileName        string    `json:"file_name" db:"file_name"`
	FileSize        int64     `json:"file_size" db:"file_size"`
	ThumbnailURL    string    `json:"thumbnail_url" db:"thumbnail_url"`
	QuotedMessageID string    `json:"quoted_message_id" db:"quoted_message_id"`
	Status          string    `json:"status" db:"status"`
	Timestamp       time.Time `json:"timestamp" db:"timestamp"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

type ChatWebSocketMessage struct {
	Type   string      `json:"type"`
	Event  string      `json:"event"`
	Data   interface{} `json:"data"`
	UserID string      `json:"user_id,omitempty"`
	Token  string      `json:"token,omitempty"`
}

// =====================================
// WEBSOCKET MANAGEMENT
// =====================================

var (
	chatWSUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for now
		},
	}

	chatConnections = make(map[string]*websocket.Conn)
	chatConnMutex   sync.RWMutex
)

// =====================================
// HELPER FUNCTIONS
// =====================================

// Generate random ID
func generateChatID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// Get conversation ID by user and JID
func getConversationID(userID, jid string) string {
	return fmt.Sprintf("%s_%s", userID, strings.ReplaceAll(jid, "@", "_"))
}

// Format JID for display
func formatJIDForDisplay(jid string) string {
	// Remove @s.whatsapp.net or @g.us suffix
	cleanJID := strings.Split(jid, "@")[0]

	// For groups, just return the JID
	if strings.Contains(jid, "@g.us") {
		return cleanJID
	}

	// For individual contacts, format phone number
	if len(cleanJID) > 10 {
		// Format as phone number: +55 11 99999-9999
		return "+" + cleanJID[:2] + " " + cleanJID[2:4] + " " + cleanJID[4:9] + "-" + cleanJID[9:]
	}

	return cleanJID
}

// =====================================
// S3 INITIALIZATION FROM ENV
// =====================================

// Initialize S3 from environment variables (SaaS mode)
func InitializeChatS3FromEnv() {
	log.Info().Msg("🚀 Initializing Chat S3 from environment variables...")

	enabled := os.Getenv("CHAT_S3_ENABLED")
	if enabled != "true" {
		log.Info().Msg("💤 Chat S3 disabled in environment (CHAT_S3_ENABLED != true)")
		return
	}

	endpoint := os.Getenv("CHAT_S3_ENDPOINT")
	region := os.Getenv("CHAT_S3_REGION")
	bucket := os.Getenv("CHAT_S3_BUCKET")
	accessKey := os.Getenv("CHAT_S3_ACCESS_KEY")
	secretKey := os.Getenv("CHAT_S3_SECRET_KEY")
	pathStyle := os.Getenv("CHAT_S3_PATH_STYLE")
	publicURL := os.Getenv("CHAT_S3_PUBLIC_URL")

	// Validate required fields
	if endpoint == "" || region == "" || bucket == "" || accessKey == "" || secretKey == "" {
		log.Error().
			Str("endpoint", endpoint).
			Str("region", region).
			Str("bucket", bucket).
			Str("accessKey", accessKey[:min(len(accessKey), 8)]+"...").
			Msg("❌ Missing required S3 environment variables")
		return
	}

	// Create S3 config
	s3Config := &S3Config{
		Enabled:   true,
		Endpoint:  endpoint,
		Region:    region,
		Bucket:    bucket,
		AccessKey: accessKey,
		SecretKey: secretKey,
		PathStyle: pathStyle == "true",
		PublicURL: publicURL,
	}

	// Initialize global S3 client
	err := GetS3Manager().InitializeS3Client("global", s3Config)
	if err != nil {
		log.Error().Err(err).Msg("❌ Failed to initialize S3 client from environment")
		return
	}

	log.Info().
		Str("endpoint", endpoint).
		Str("bucket", bucket).
		Str("region", region).
		Bool("pathStyle", pathStyle == "true").
		Msg("✅ Chat S3 initialized from environment - ALL users will use this S3!")
}

// Helper function to get minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// =====================================
// DATABASE FUNCTIONS
// =====================================

// Save or update conversation with profile info
func saveConversationWithProfile(dbConn *sqlx.DB, userID, jid, name, displayName, avatarURL string, isGroup bool) (*Conversation, error) {
	conversationID := getConversationID(userID, jid)
	if displayName == "" {
		displayName = name
	}
	if displayName == "" {
		displayName = formatJIDForDisplay(jid)
	}

	// Check if conversation exists
	var existingConv Conversation
	err := dbConn.Get(&existingConv,
		"SELECT * FROM conversations WHERE user_id = $1 AND jid = $2 LIMIT 1",
		userID, jid)

	if err == sql.ErrNoRows {
		// Create new conversation
		conv := &Conversation{
			ID:              conversationID,
			UserID:          userID,
			JID:             jid,
			Name:            name,
			DisplayName:     displayName,
			LastMessage:     "",
			LastMessageTime: time.Now(),
			UnreadCount:     0,
			AvatarURL:       avatarURL,
			IsGroup:         isGroup,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}

		_, err = dbConn.NamedExec(`
			INSERT INTO conversations (id, user_id, jid, name, display_name, last_message, 
				last_message_time, unread_count, avatar_url, is_group, created_at, updated_at)
			VALUES (:id, :user_id, :jid, :name, :display_name, :last_message, 
				:last_message_time, :unread_count, :avatar_url, :is_group, :created_at, :updated_at)
		`, conv)

		if err != nil {
			return nil, fmt.Errorf("failed to create conversation: %w", err)
		}

		return conv, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to check conversation: %w", err)
	}

	// Update existing conversation with profile info
	existingConv.Name = name
	existingConv.DisplayName = displayName
	if avatarURL != "" {
		existingConv.AvatarURL = avatarURL
	}
	existingConv.UpdatedAt = time.Now()

	_, err = dbConn.NamedExec(`
		UPDATE conversations 
		SET name = :name, display_name = :display_name, avatar_url = :avatar_url, updated_at = :updated_at
		WHERE id = :id
	`, &existingConv)

	if err != nil {
		return nil, fmt.Errorf("failed to update conversation: %w", err)
	}

	return &existingConv, nil
}

// Save or update conversation (legacy function for compatibility)
func saveConversation(dbConn *sqlx.DB, userID, jid, name string, isGroup bool) (*Conversation, error) {
	conversationID := getConversationID(userID, jid)
	displayName := name
	if displayName == "" {
		displayName = formatJIDForDisplay(jid)
	}

	// Check if conversation exists
	var existingConv Conversation
	err := dbConn.Get(&existingConv,
		"SELECT * FROM conversations WHERE user_id = $1 AND jid = $2 LIMIT 1",
		userID, jid)

	if err == sql.ErrNoRows {
		// Create new conversation
		conv := &Conversation{
			ID:              conversationID,
			UserID:          userID,
			JID:             jid,
			Name:            name,
			DisplayName:     displayName,
			LastMessage:     "",
			LastMessageTime: time.Now(),
			UnreadCount:     0,
			AvatarURL:       "",
			IsGroup:         isGroup,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}

		_, err = dbConn.NamedExec(`
			INSERT INTO conversations (id, user_id, jid, name, display_name, last_message, 
				last_message_time, unread_count, avatar_url, is_group, created_at, updated_at)
			VALUES (:id, :user_id, :jid, :name, :display_name, :last_message, 
				:last_message_time, :unread_count, :avatar_url, :is_group, :created_at, :updated_at)
		`, conv)

		if err != nil {
			return nil, fmt.Errorf("failed to create conversation: %w", err)
		}

		return conv, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to check conversation: %w", err)
	}

	// Update existing conversation
	existingConv.Name = name
	existingConv.DisplayName = displayName
	existingConv.UpdatedAt = time.Now()

	_, err = dbConn.NamedExec(`
		UPDATE conversations 
		SET name = :name, display_name = :display_name, updated_at = :updated_at
		WHERE id = :id
	`, &existingConv)

	if err != nil {
		return nil, fmt.Errorf("failed to update conversation: %w", err)
	}

	return &existingConv, nil
}

// Update conversation profile (name and avatar)
func updateConversationProfile(dbConn *sqlx.DB, userID, jid, displayName, avatarURL string) error {
	_, err := dbConn.Exec(`
		UPDATE conversations 
		SET display_name = $1, avatar_url = $2, updated_at = $3
		WHERE user_id = $4 AND jid = $5
	`, displayName, avatarURL, time.Now(), userID, jid)

	if err != nil {
		return fmt.Errorf("failed to update conversation profile: %w", err)
	}

	log.Info().
		Str("userID", userID).
		Str("jid", jid).
		Str("displayName", displayName).
		Str("avatarURL", avatarURL).
		Msg("Updated conversation profile in database")

	return nil
}

// Save message with media support to database
func saveMessageWithMedia(dbConn *sqlx.DB, userID, conversationID, messageID, fromJID, toJID string, fromMe bool,
	messageType, textContent, mediaURL, mediaType, fileName string, fileSize int64, thumbnailURL string, timestamp time.Time) (*Message, error) {

	msg := &Message{
		ID:              generateChatID(),
		ConversationID:  conversationID,
		MessageID:       messageID,
		FromJID:         fromJID,
		ToJID:           toJID,
		FromMe:          fromMe,
		MessageType:     messageType,
		TextContent:     textContent,
		MediaURL:        mediaURL,
		MediaType:       mediaType,
		FileName:        fileName,
		FileSize:        fileSize,
		ThumbnailURL:    thumbnailURL,
		QuotedMessageID: "",
		Status:          "delivered",
		Timestamp:       timestamp,
		CreatedAt:       time.Now(),
	}

	_, err := dbConn.NamedExec(`
		INSERT INTO messages (id, conversation_id, message_id, from_jid, to_jid, from_me,
			message_type, text_content, media_url, media_type, file_name, file_size,
			thumbnail_url, quoted_message_id, status, timestamp, created_at)
		VALUES (:id, :conversation_id, :message_id, :from_jid, :to_jid, :from_me,
			:message_type, :text_content, :media_url, :media_type, :file_name, :file_size,
			:thumbnail_url, :quoted_message_id, :status, :timestamp, :created_at)
	`, msg)

	if err != nil {
		return nil, fmt.Errorf("failed to save message: %w", err)
	}

	// Update conversation's last message
	lastMessageText := textContent
	if messageType != "text" && textContent == "" {
		switch messageType {
		case "image":
			lastMessageText = "📷 Imagem"
		case "video":
			lastMessageText = "🎥 Vídeo"
		case "audio":
			lastMessageText = "🎵 Áudio"
		case "document":
			lastMessageText = "📄 Documento"
		default:
			lastMessageText = "📎 Arquivo"
		}
	}

	_, err = dbConn.Exec(`
		UPDATE conversations 
		SET last_message = $1, last_message_time = $2, updated_at = $3
		WHERE id = $4
	`, lastMessageText, timestamp, time.Now(), conversationID)

	if err != nil {
		log.Error().Err(err).Msg("Failed to update conversation last message")
	}

	return msg, nil
}

// Save message to database (legacy function for compatibility)
func saveMessage(dbConn *sqlx.DB, userID, conversationID, messageID, fromJID, toJID string, fromMe bool,
	messageType, textContent string, timestamp time.Time) (*Message, error) {
	return saveMessageWithMedia(dbConn, userID, conversationID, messageID, fromJID, toJID, fromMe,
		messageType, textContent, "", "", "", 0, "", timestamp)
}

// Download WhatsApp media and upload to S3 (SAAS CENTRALIZED)
func downloadAndUploadChatMediaToS3(userID, whatsappURL, messageID, mediaType string, waClient *whatsmeow.Client, message interface{}) (string, error) {
	// Check if GLOBAL S3 is configured (SaaS mode)
	client, config, ok := GetS3Manager().GetClient("global")
	if !ok {
		log.Debug().Str("userID", userID).Msg("No global S3 config found, using original URL")
		return whatsappURL, nil // Fallback to original URL
	}

	log.Info().
		Str("userID", userID).
		Str("whatsappURL", whatsappURL).
		Str("messageID", messageID).
		Msg("Downloading WhatsApp media for S3 upload")

	// 1. Download using WhatsApp client (with decryption)
	var mediaData []byte
	var mimeType string
	var err error

	log.Info().Msg("Using WhatsApp client to download and decrypt media")

	// Create context for download with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Try to download using whatsmeow client based on message type
	switch msg := message.(type) {
	case *waE2E.ImageMessage:
		log.Debug().Msg("Downloading ImageMessage with whatsmeow client")
		mediaData, err = waClient.Download(ctx, msg)
		if msg.Mimetype != nil {
			mimeType = *msg.Mimetype
		}
	case *waE2E.VideoMessage:
		log.Debug().Msg("Downloading VideoMessage with whatsmeow client")
		mediaData, err = waClient.Download(ctx, msg)
		if msg.Mimetype != nil {
			mimeType = *msg.Mimetype
		}
	case *waE2E.AudioMessage:
		log.Debug().Msg("Downloading AudioMessage with whatsmeow client")
		mediaData, err = waClient.Download(ctx, msg)
		if msg.Mimetype != nil {
			mimeType = *msg.Mimetype
		}
	case *waE2E.DocumentMessage:
		log.Debug().Msg("Downloading DocumentMessage with whatsmeow client")
		mediaData, err = waClient.Download(ctx, msg)
		if msg.Mimetype != nil {
			mimeType = *msg.Mimetype
		}
	case *waE2E.StickerMessage:
		log.Debug().Msg("Downloading StickerMessage with whatsmeow client")
		mediaData, err = waClient.Download(ctx, msg)
		if msg.Mimetype != nil {
			mimeType = *msg.Mimetype
		}
	default:
		log.Warn().Str("messageType", fmt.Sprintf("%T", message)).Msg("Unsupported message type for whatsmeow download, falling back to HTTP")
		// Fallback to HTTP download if message type is not supported
		req, err := http.NewRequestWithContext(ctx, "GET", whatsappURL, nil)
		if err != nil {
			log.Error().Err(err).Msg("Failed to create request for WhatsApp media")
			return whatsappURL, err
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Error().Err(err).Msg("Failed to download WhatsApp media")
			return whatsappURL, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Error().Int("status", resp.StatusCode).Msg("WhatsApp media download failed")
			return whatsappURL, fmt.Errorf("download failed with status %d", resp.StatusCode)
		}

		mediaData, err = io.ReadAll(resp.Body)
		if err != nil {
			log.Error().Err(err).Msg("Failed to read WhatsApp media data")
			return whatsappURL, err
		}
		mimeType = resp.Header.Get("Content-Type")
	}

	if err != nil {
		log.Error().Err(err).Msg("Failed to download media with WhatsApp client")
		return whatsappURL, err
	}

	if len(mediaData) == 0 {
		log.Error().Msg("Downloaded media data is empty")
		return whatsappURL, fmt.Errorf("downloaded media data is empty")
	}

	log.Info().
		Int("size", len(mediaData)).
		Str("mimeType", mimeType).
		Msg("Successfully downloaded and decrypted media")

	// 3. Generate S3 key and determine extension
	var extension string

	log.Debug().
		Str("mediaType", mediaType).
		Str("mimeType", mimeType).
		Str("whatsappURL", whatsappURL).
		Msg("Determining file extension")

	// Use mimeType from WhatsApp message or fallback content type
	if mimeType != "" {
		log.Debug().Str("mimeType", mimeType).Msg("Using mimeType from WhatsApp message")
		switch mimeType {
		case "image/jpeg":
			extension = ".jpg"
		case "image/png":
			extension = ".png"
		case "image/gif":
			extension = ".gif"
		case "image/webp":
			extension = ".webp"
		case "video/mp4":
			extension = ".mp4"
		case "video/webm":
			extension = ".webm"
		case "audio/mpeg":
			extension = ".mp3"
		case "audio/ogg":
			extension = ".ogg"
		case "audio/wav":
			extension = ".wav"
		default:
			// Check partial mime types
			if strings.Contains(mimeType, "jpeg") {
				extension = ".jpg"
			} else if strings.Contains(mimeType, "png") {
				extension = ".png"
			} else if strings.Contains(mimeType, "gif") {
				extension = ".gif"
			} else if strings.Contains(mimeType, "image") {
				extension = ".jpg" // default for images
			} else if strings.Contains(mimeType, "video") {
				extension = ".mp4"
			} else if strings.Contains(mimeType, "audio") {
				extension = ".mp3"
			} else {
				// Fallback to mediaType
				switch mediaType {
				case "image":
					extension = ".jpg"
				case "video":
					extension = ".mp4"
				case "audio":
					extension = ".mp3"
				case "document":
					extension = ".pdf"
				default:
					extension = ".bin"
				}
			}
		}
	} else {
		// No Content-Type, use mediaType or URL extension
		switch mediaType {
		case "image":
			extension = ".jpg"
		case "video":
			extension = ".mp4"
		case "audio":
			extension = ".mp3"
		case "document":
			extension = ".pdf"
		default:
			extension = filepath.Ext(whatsappURL)
			if extension == "" {
				extension = ".bin"
			}
		}
	}

	s3Key := fmt.Sprintf("chat/%s/%s%s", userID, messageID, extension)

	// 4. Upload to S3
	log.Info().
		Str("bucket", config.Bucket).
		Str("s3Key", s3Key).
		Int("size", len(mediaData)).
		Msg("Uploading media to S3")

	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &config.Bucket,
		Key:         &s3Key,
		Body:        strings.NewReader(string(mediaData)),
		ContentType: &mediaType,
	})

	if err != nil {
		log.Error().Err(err).Msg("Failed to upload media to S3")
		return whatsappURL, err
	}

	// 5. Generate permanent URL
	var permanentURL string
	if config.PublicURL != "" {
		// Use custom public URL if configured
		permanentURL = strings.TrimRight(config.PublicURL, "/") + "/" + s3Key
	} else {
		// Use S3 endpoint URL
		endpoint := strings.TrimRight(config.Endpoint, "/")
		if config.PathStyle {
			permanentURL = fmt.Sprintf("%s/%s/%s", endpoint, config.Bucket, s3Key)
		} else {
			// Virtual hosted-style (not used by Hetzner, but for compatibility)
			permanentURL = fmt.Sprintf("https://%s.%s/%s", config.Bucket, strings.TrimPrefix(endpoint, "https://"), s3Key)
		}
	}

	log.Info().
		Str("permanentURL", permanentURL).
		Str("originalURL", whatsappURL).
		Msg("Media successfully uploaded to S3")

	return permanentURL, nil
}

// Get conversations for user
func getConversationsForUser(dbConn *sqlx.DB, userID string) ([]Conversation, error) {
	var conversations []Conversation
	err := dbConn.Select(&conversations, `
		SELECT * FROM conversations 
		WHERE user_id = $1 
		ORDER BY last_message_time DESC
	`, userID)

	if err != nil {
		return nil, fmt.Errorf("failed to get conversations: %w", err)
	}

	return conversations, nil
}

// Get messages for conversation
func getMessagesForConversation(dbConn *sqlx.DB, conversationID string, limit int, offset int) ([]Message, error) {
	if limit <= 0 {
		limit = 50
	}

	var messages []Message
	err := dbConn.Select(&messages, `
		SELECT * FROM messages 
		WHERE conversation_id = $1 
		ORDER BY timestamp DESC 
		LIMIT $2 OFFSET $3
	`, conversationID, limit, offset)

	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	// Reverse to show oldest first
	for i := len(messages)/2 - 1; i >= 0; i-- {
		opp := len(messages) - 1 - i
		messages[i], messages[opp] = messages[opp], messages[i]
	}

	return messages, nil
}

// =====================================
// WEBSOCKET FUNCTIONS
// =====================================

// Send message to WebSocket client
func sendChatWebSocketMessage(userID string, msgType, event string, data interface{}) {
	chatConnMutex.RLock()
	conn, exists := chatConnections[userID]
	chatConnMutex.RUnlock()

	if !exists {
		return
	}

	message := ChatWebSocketMessage{
		Type:   msgType,
		Event:  event,
		Data:   data,
		UserID: userID,
	}

	err := conn.WriteJSON(message)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to send WebSocket message")
		// Remove dead connection
		chatConnMutex.Lock()
		delete(chatConnections, userID)
		chatConnMutex.Unlock()
		conn.Close()
	}
}

// Broadcast message to all connected clients
func broadcastChatWebSocketMessage(msgType, event string, data interface{}) {
	chatConnMutex.RLock()
	defer chatConnMutex.RUnlock()

	message := ChatWebSocketMessage{
		Type:  msgType,
		Event: event,
		Data:  data,
	}

	for userID, conn := range chatConnections {
		err := conn.WriteJSON(message)
		if err != nil {
			log.Error().Err(err).Str("user_id", userID).Msg("Failed to broadcast WebSocket message")
			delete(chatConnections, userID)
			conn.Close()
		}
	}
}

// =====================================
// EVENT HANDLERS
// =====================================

// Save sent message to chat database (called from SendMessage handler)
func saveSentMessageToChat(dbConn *sqlx.DB, userID string, recipientJID string, messageID string, textContent string, timestamp time.Time) error {
	// Get or create conversation
	contactName := formatJIDForDisplay(recipientJID)
	isGroup := strings.Contains(recipientJID, "@g.us")

	conversation, err := saveConversation(dbConn, userID, recipientJID, contactName, isGroup)
	if err != nil {
		return fmt.Errorf("failed to save conversation: %w", err)
	}

	// Save message as sent by me (fromMe = true)
	_, err = saveMessage(
		dbConn,
		userID,
		conversation.ID,
		messageID,
		userID,       // fromJID is userID for sent messages
		recipientJID, // toJID
		true,         // fromMe = true
		"text",
		textContent,
		timestamp,
	)
	if err != nil {
		return fmt.Errorf("failed to save sent message: %w", err)
	}

	log.Info().
		Str("messageID", messageID).
		Str("recipientJID", recipientJID).
		Msg("Sent message saved to chat database")

	return nil
}

// Process WhatsApp message event and save to chat
func processChatMessageEvent(dbConn *sqlx.DB, userID string, waClient *whatsmeow.Client, evt *events.Message) {
	if evt.Message == nil {
		return
	}

	// Extract message info with media support
	var textContent, mediaURL, mediaType, fileName, thumbnailURL string
	var fileSize int64
	msgType := "text"

	if evt.Message.Conversation != nil {
		textContent = *evt.Message.Conversation
	} else if evt.Message.ExtendedTextMessage != nil && evt.Message.ExtendedTextMessage.Text != nil {
		textContent = *evt.Message.ExtendedTextMessage.Text
	} else if evt.Message.ImageMessage != nil {
		// Handle image message
		msgType = "image"
		mediaType = "image"
		if evt.Message.ImageMessage.Caption != nil {
			textContent = *evt.Message.ImageMessage.Caption
		}
		if evt.Message.ImageMessage.URL != nil {
			tempURL := *evt.Message.ImageMessage.URL
			// Try to upload to S3 for permanent storage
			permanentURL, err := downloadAndUploadChatMediaToS3(userID, tempURL, evt.Info.ID, mediaType, waClient, evt.Message.ImageMessage)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to upload image to S3, using temporary URL")
				mediaURL = tempURL
			} else {
				mediaURL = permanentURL
				log.Info().Str("s3URL", permanentURL).Msg("Image uploaded to S3 successfully")
			}
		}
		if evt.Message.ImageMessage.Mimetype != nil {
			mediaType = *evt.Message.ImageMessage.Mimetype
		}
		if evt.Message.ImageMessage.FileLength != nil {
			fileSize = int64(*evt.Message.ImageMessage.FileLength)
		}
		if textContent == "" {
			textContent = "📷 Imagem"
		}
	} else if evt.Message.VideoMessage != nil {
		// Handle video message
		msgType = "video"
		mediaType = "video"
		if evt.Message.VideoMessage.Caption != nil {
			textContent = *evt.Message.VideoMessage.Caption
		}
		if evt.Message.VideoMessage.URL != nil {
			tempURL := *evt.Message.VideoMessage.URL
			// Try to upload to S3 for permanent storage
			permanentURL, err := downloadAndUploadChatMediaToS3(userID, tempURL, evt.Info.ID, mediaType, waClient, evt.Message.VideoMessage)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to upload video to S3, using temporary URL")
				mediaURL = tempURL
			} else {
				mediaURL = permanentURL
				log.Info().Str("s3URL", permanentURL).Msg("Video uploaded to S3 successfully")
			}
		}
		if evt.Message.VideoMessage.Mimetype != nil {
			mediaType = *evt.Message.VideoMessage.Mimetype
		}
		if evt.Message.VideoMessage.FileLength != nil {
			fileSize = int64(*evt.Message.VideoMessage.FileLength)
		}
		if textContent == "" {
			textContent = "🎥 Vídeo"
		}
	} else if evt.Message.AudioMessage != nil {
		// Handle audio message
		msgType = "audio"
		mediaType = "audio"
		if evt.Message.AudioMessage.URL != nil {
			tempURL := *evt.Message.AudioMessage.URL
			// Try to upload to S3 for permanent storage
			permanentURL, err := downloadAndUploadChatMediaToS3(userID, tempURL, evt.Info.ID, mediaType, waClient, evt.Message.AudioMessage)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to upload audio to S3, using temporary URL")
				mediaURL = tempURL
			} else {
				mediaURL = permanentURL
				log.Info().Str("s3URL", permanentURL).Msg("Audio uploaded to S3 successfully")
			}
		}
		if evt.Message.AudioMessage.Mimetype != nil {
			mediaType = *evt.Message.AudioMessage.Mimetype
		}
		if evt.Message.AudioMessage.FileLength != nil {
			fileSize = int64(*evt.Message.AudioMessage.FileLength)
		}
		textContent = "🎵 Áudio"
	} else if evt.Message.DocumentMessage != nil {
		// Handle document message
		msgType = "document"
		mediaType = "document"
		if evt.Message.DocumentMessage.FileName != nil {
			fileName = *evt.Message.DocumentMessage.FileName
		}
		if evt.Message.DocumentMessage.URL != nil {
			tempURL := *evt.Message.DocumentMessage.URL
			// Try to upload to S3 for permanent storage
			permanentURL, err := downloadAndUploadChatMediaToS3(userID, tempURL, evt.Info.ID, mediaType, waClient, evt.Message.DocumentMessage)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to upload document to S3, using temporary URL")
				mediaURL = tempURL
			} else {
				mediaURL = permanentURL
				log.Info().Str("s3URL", permanentURL).Msg("Document uploaded to S3 successfully")
			}
		}
		if evt.Message.DocumentMessage.Mimetype != nil {
			mediaType = *evt.Message.DocumentMessage.Mimetype
		}
		if evt.Message.DocumentMessage.FileLength != nil {
			fileSize = int64(*evt.Message.DocumentMessage.FileLength)
		}
		if fileName != "" {
			textContent = "📄 " + fileName
		} else {
			textContent = "📄 Documento"
		}
	} else if evt.Message.StickerMessage != nil {
		// Handle sticker message
		msgType = "sticker"
		mediaType = "sticker"
		if evt.Message.StickerMessage.URL != nil {
			tempURL := *evt.Message.StickerMessage.URL
			// Try to upload to S3 for permanent storage
			permanentURL, err := downloadAndUploadChatMediaToS3(userID, tempURL, evt.Info.ID, mediaType, waClient, evt.Message.StickerMessage)
			if err != nil {
				log.Warn().Err(err).Msg("Failed to upload sticker to S3, using temporary URL")
				mediaURL = tempURL
			} else {
				mediaURL = permanentURL
				log.Info().Str("s3URL", permanentURL).Msg("Sticker uploaded to S3 successfully")
			}
		}
		if evt.Message.StickerMessage.Mimetype != nil {
			mediaType = *evt.Message.StickerMessage.Mimetype
		}
		textContent = "🎭 Figurinha"
	} else {
		// Handle other message types
		textContent = "📎 Arquivo"
		msgType = "media"
	}

	// Determine if it's from me
	fromMe := evt.Info.IsFromMe
	fromJID := evt.Info.Sender.String()
	toJID := evt.Info.Chat.String()

	// For group messages, the sender is different
	if evt.Info.IsGroup {
		fromJID = evt.Info.Sender.String()
	}

	// Get or create conversation
	conversationJID := evt.Info.Chat.String()
	isGroup := evt.Info.IsGroup

	// Get contact name (for now, use formatted JID)
	contactName := formatJIDForDisplay(conversationJID)

	conversation, err := saveConversation(dbConn, userID, conversationJID, contactName, isGroup)
	if err != nil {
		log.Error().Err(err).Msg("Failed to save conversation")
		return
	}

	// Save message with media support
	message, err := saveMessageWithMedia(
		dbConn,
		userID,
		conversation.ID,
		evt.Info.ID,
		fromJID,
		toJID,
		fromMe,
		msgType,
		textContent,
		mediaURL,
		mediaType,
		fileName,
		fileSize,
		thumbnailURL,
		evt.Info.Timestamp,
	)
	if err != nil {
		log.Error().Err(err).Msg("Failed to save message")
		return
	}

	// Send real-time update via WebSocket
	sendChatWebSocketMessage(userID, "message", "new_message", map[string]interface{}{
		"conversation": conversation,
		"message":      message,
	})

	log.Debug().
		Str("user_id", userID).
		Str("conversation_id", conversation.ID).
		Str("message_id", message.ID).
		Str("text", textContent).
		Bool("from_me", fromMe).
		Msg("Chat message processed")
}

// =====================================
// HTTP HANDLERS
// =====================================

// WebSocket endpoint for chat
func (s *server) ChatWebSocket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Get user info from context
		userInfo := r.Context().Value("userinfo").(Values)
		userID := userInfo.Get("Id")

		if userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Upgrade connection to WebSocket
		conn, err := chatWSUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Error().Err(err).Msg("Failed to upgrade WebSocket connection")
			return
		}

		// Store connection
		chatConnMutex.Lock()
		chatConnections[userID] = conn
		chatConnMutex.Unlock()

		log.Info().Str("user_id", userID).Msg("Chat WebSocket connected")

		// Send initial message
		sendChatWebSocketMessage(userID, "system", "connected", map[string]string{
			"status":  "connected",
			"user_id": userID,
		})

		// Handle connection cleanup
		defer func() {
			chatConnMutex.Lock()
			delete(chatConnections, userID)
			chatConnMutex.Unlock()
			conn.Close()
			log.Info().Str("user_id", userID).Msg("Chat WebSocket disconnected")
		}()

		// Keep connection alive and handle incoming messages
		for {
			var msg ChatWebSocketMessage
			err := conn.ReadJSON(&msg)
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Error().Err(err).Str("user_id", userID).Msg("WebSocket error")
				}
				break
			}

			// Handle ping/pong
			if msg.Type == "ping" {
				sendChatWebSocketMessage(userID, "pong", "heartbeat", map[string]interface{}{
					"timestamp": time.Now(),
				})
			}
		}
	}
}

// Get conversations for current user
func (s *server) GetChatConversations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info().Msg("GetChatConversations: Starting")

		// Get user info from context
		userInfo, ok := r.Context().Value("userinfo").(Values)
		if !ok {
			log.Error().Msg("GetChatConversations: Failed to get userinfo from context")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error": "Failed to get user info"}`))
			return
		}

		userID := userInfo.Get("Id")
		log.Info().Str("user_id", userID).Msg("GetChatConversations: Got user ID")

		if userID == "" {
			log.Error().Msg("GetChatConversations: User ID is empty")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error": "User ID is empty"}`))
			return
		}

		// Get conversations
		conversations, err := getConversationsForUser(s.db, userID)
		if err != nil {
			log.Error().Err(err).Str("user_id", userID).Msg("GetChatConversations: Failed to get conversations")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error": "Database error"}`))
			return
		}

		log.Info().Int("conversations_len", len(conversations)).Msg("GetChatConversations: Got conversations")

		// Convert to frontend format
		response := make([]map[string]interface{}, len(conversations))
		for i, conv := range conversations {
			// Safe timestamp conversion
			var timestamp int64
			if !conv.LastMessageTime.IsZero() {
				timestamp = conv.LastMessageTime.UnixMilli()
			} else {
				timestamp = 0
			}

			response[i] = map[string]interface{}{
				"id":            conv.JID, // Use JID as frontend ID
				"name":          conv.DisplayName,
				"displayName":   conv.DisplayName,
				"profilePicUrl": conv.AvatarURL,
				"lastMessage":   conv.LastMessage,
				"timestamp":     timestamp,
				"unread":        conv.UnreadCount,
				"avatar":        conv.AvatarURL,
			}
		}

		log.Info().Msg("GetChatConversations: Successfully returning response")

		// Return response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		// Manual JSON encoding to avoid potential issues
		if len(response) == 0 {
			w.Write([]byte("[]"))
		} else {
			w.Write([]byte("["))
			for i, item := range response {
				if i > 0 {
					w.Write([]byte(","))
				}

				// Safe string escaping for JSON
				avatar := "null"
				if item["avatar"] != nil && item["avatar"].(string) != "" {
					avatar = fmt.Sprintf(`"%s"`, item["avatar"].(string))
				}

				profilePicUrl := "null"
				if item["profilePicUrl"] != nil && item["profilePicUrl"].(string) != "" {
					profilePicUrl = fmt.Sprintf(`"%s"`, item["profilePicUrl"].(string))
				}

				w.Write([]byte(fmt.Sprintf(`{"id":"%s","name":"%s","displayName":"%s","profilePicUrl":%s,"lastMessage":"%s","timestamp":%d,"unread":%d,"avatar":%s}`,
					item["id"].(string),
					item["name"].(string),
					item["displayName"].(string),
					profilePicUrl,
					item["lastMessage"].(string),
					item["timestamp"].(int64),
					item["unread"].(int),
					avatar,
				)))
			}
			w.Write([]byte("]"))
		}
	}
}

// Get messages for a conversation
func (s *server) GetChatMessages() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Info().Msg("GetChatMessages: Starting")

		// Get user info from context
		userInfo, ok := r.Context().Value("userinfo").(Values)
		if !ok {
			log.Error().Msg("GetChatMessages: Failed to get userinfo from context")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error": "Failed to get user info"}`))
			return
		}

		userID := userInfo.Get("Id")
		log.Info().Str("user_id", userID).Msg("GetChatMessages: Got user ID")

		vars := mux.Vars(r)
		contactJID := vars["contact"]

		log.Info().Str("contact_jid", contactJID).Msg("GetChatMessages: Got contact JID")

		if contactJID == "" {
			log.Error().Msg("GetChatMessages: Contact JID is required")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error": "Contact JID is required"}`))
			return
		}

		// Get conversation ID
		conversationID := getConversationID(userID, contactJID)
		log.Info().Str("conversation_id", conversationID).Msg("GetChatMessages: Generated conversation ID")

		// Parse query parameters
		limitStr := r.URL.Query().Get("limit")
		offsetStr := r.URL.Query().Get("offset")

		limit := 50
		offset := 0

		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
				limit = l
			}
		}

		if offsetStr != "" {
			if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
				offset = o
			}
		}

		log.Info().Int("limit", limit).Int("offset", offset).Msg("GetChatMessages: Query parameters")

		messages, err := getMessagesForConversation(s.db, conversationID, limit, offset)
		if err != nil {
			log.Error().Err(err).Str("conversation_id", conversationID).Msg("GetChatMessages: Failed to get messages")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error": "Database error"}`))
			return
		}

		log.Info().Int("messages_len", len(messages)).Msg("GetChatMessages: Got messages")

		// Convert to frontend format and return manual JSON
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		if len(messages) == 0 {
			w.Write([]byte("[]"))
		} else {
			w.Write([]byte("["))
			for i, msg := range messages {
				if i > 0 {
					w.Write([]byte(","))
				}

				// Safe timestamp conversion
				var timestamp int64
				if !msg.Timestamp.IsZero() {
					timestamp = msg.Timestamp.UnixMilli()
				} else {
					timestamp = 0
				}

				// Escape JSON strings safely
				text := strings.ReplaceAll(msg.TextContent, `"`, `\"`)
				mediaURL := strings.ReplaceAll(msg.MediaURL, `"`, `\"`)
				mediaType := strings.ReplaceAll(msg.MediaType, `"`, `\"`)
				fileName := strings.ReplaceAll(msg.FileName, `"`, `\"`)
				thumbnailURL := strings.ReplaceAll(msg.ThumbnailURL, `"`, `\"`)

				w.Write([]byte(fmt.Sprintf(`{"id":"%s","from":"%s","text":"%s","timestamp":%d,"fromMe":%t,"status":"%s","messageType":"%s","mediaURL":"%s","mediaType":"%s","fileName":"%s","fileSize":%d,"thumbnailURL":"%s"}`,
					msg.MessageID,
					msg.FromJID,
					text,
					timestamp,
					msg.FromMe,
					msg.Status,
					msg.MessageType,
					mediaURL,
					mediaType,
					fileName,
					msg.FileSize,
					thumbnailURL,
				)))
			}
			w.Write([]byte("]"))
		}

		log.Info().Msg("GetChatMessages: Successfully returned response")
	}
}

// Update conversation profile (name and avatar) - Called by frontend after fetching profile
func (s *server) UpdateChatProfile() http.HandlerFunc {
	type ProfileUpdateRequest struct {
		JID           string `json:"jid"`
		DisplayName   string `json:"displayName"`
		ProfilePicUrl string `json:"profilePicUrl"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		log.Info().Msg("UpdateChatProfile: Starting")

		// Get user info from context
		userInfo, ok := r.Context().Value("userinfo").(Values)
		if !ok {
			log.Error().Msg("UpdateChatProfile: Failed to get userinfo from context")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error": "Failed to get user info"}`))
			return
		}

		userID := userInfo.Get("Id")
		log.Info().Str("user_id", userID).Msg("UpdateChatProfile: Got user ID")

		// Parse request body
		var req ProfileUpdateRequest
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			log.Error().Err(err).Msg("UpdateChatProfile: Failed to decode request")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error": "Invalid request body"}`))
			return
		}

		if req.JID == "" {
			log.Error().Msg("UpdateChatProfile: JID is required")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error": "JID is required"}`))
			return
		}

		// Update conversation profile in database
		err = updateConversationProfile(s.db, userID, req.JID, req.DisplayName, req.ProfilePicUrl)
		if err != nil {
			log.Error().Err(err).Str("jid", req.JID).Msg("UpdateChatProfile: Failed to update profile")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error": "Failed to update profile"}`))
			return
		}

		log.Info().
			Str("jid", req.JID).
			Str("displayName", req.DisplayName).
			Str("profilePicUrl", req.ProfilePicUrl).
			Msg("UpdateChatProfile: Profile updated successfully")

		// Return success
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success": true, "message": "Profile updated"}`))
	}
}
