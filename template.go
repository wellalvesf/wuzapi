package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

// SendTemplate envia Template (hydrated) com quick reply, url e call
func (s *server) SendTemplate() http.HandlerFunc {

	type buttonStruct struct {
		DisplayText string `json:"DisplayText"`
		Id          string `json:"Id"`
		Url         string `json:"Url"`
		PhoneNumber string `json:"PhoneNumber"`
		Type        string `json:"Type"`
	}

	type templateStruct struct {
		Phone   string         `json:"Phone"`
		Content string         `json:"Content"`
		Footer  string         `json:"Footer"`
		Id      string         `json:"Id,omitempty"`
		Buttons []buttonStruct `json:"Buttons"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		txtid := r.Context().Value("userinfo").(Values).Get("Id")

		if clientManager.GetWhatsmeowClient(txtid) == nil {
			s.Respond(w, r, http.StatusInternalServerError, errors.New("no session"))
			return
		}

		var resp whatsmeow.SendResponse
		msgid := ""

		decoder := json.NewDecoder(r.Body)
		var t templateStruct
		if err := decoder.Decode(&t); err != nil {
			s.Respond(w, r, http.StatusBadRequest, errors.New("could not decode Payload"))
			return
		}

		if t.Phone == "" {
			s.Respond(w, r, http.StatusBadRequest, errors.New("missing Phone in Payload"))
			return
		}
		if t.Content == "" {
			s.Respond(w, r, http.StatusBadRequest, errors.New("missing Content in Payload"))
			return
		}
		if t.Footer == "" {
			s.Respond(w, r, http.StatusBadRequest, errors.New("missing Footer in Payload"))
			return
		}
		if len(t.Buttons) < 1 {
			s.Respond(w, r, http.StatusBadRequest, errors.New("missing Buttons in Payload"))
			return
		}

		recipient, ok := parseJID(t.Phone)
		if !ok {
			s.Respond(w, r, http.StatusBadRequest, errors.New("could not parse Phone"))
			return
		}

		if t.Id == "" {
			msgid = clientManager.GetWhatsmeowClient(txtid).GenerateMessageID()
		} else {
			msgid = t.Id
		}

		var buttons []*waE2E.HydratedTemplateButton
		btnIndex := 1
		onlyQuickReplies := true
		for _, item := range t.Buttons {
			switch item.Type {
			case "quickreply", "quick_reply":
				idtext := item.Id
				if idtext == "" {
					idtext = strconv.Itoa(btnIndex)
				}
				text := item.DisplayText
				buttons = append(buttons, &waE2E.HydratedTemplateButton{
					Index: proto.Uint32(uint32(btnIndex)),
					HydratedButton: &waE2E.HydratedTemplateButton_QuickReplyButton{
						QuickReplyButton: &waE2E.HydratedTemplateButton_HydratedQuickReplyButton{
							DisplayText: &text,
							ID:          proto.String(idtext),
						},
					},
				})
			case "url", "cta_url":
				text := item.DisplayText
				url := item.Url
				buttons = append(buttons, &waE2E.HydratedTemplateButton{
					Index: proto.Uint32(uint32(btnIndex)),
					HydratedButton: &waE2E.HydratedTemplateButton_UrlButton{
						UrlButton: &waE2E.HydratedTemplateButton_HydratedURLButton{
							DisplayText: &text,
							URL:         &url,
						},
					},
				})
				onlyQuickReplies = false
			case "call", "cta_call":
				text := item.DisplayText
				phonenumber := item.PhoneNumber
				buttons = append(buttons, &waE2E.HydratedTemplateButton{
					Index: proto.Uint32(uint32(btnIndex)),
					HydratedButton: &waE2E.HydratedTemplateButton_CallButton{
						CallButton: &waE2E.HydratedTemplateButton_HydratedCallButton{
							DisplayText: &text,
							PhoneNumber: &phonenumber,
						},
					},
				})
				onlyQuickReplies = false
			default:
				// fallback: tratar como quick reply
				idtext := item.Id
				if idtext == "" {
					idtext = strconv.Itoa(btnIndex)
				}
				text := item.DisplayText
				buttons = append(buttons, &waE2E.HydratedTemplateButton{
					Index: proto.Uint32(uint32(btnIndex)),
					HydratedButton: &waE2E.HydratedTemplateButton_QuickReplyButton{
						QuickReplyButton: &waE2E.HydratedTemplateButton_HydratedQuickReplyButton{
							DisplayText: &text,
							ID:          proto.String(idtext),
						},
					},
				})
			}
			btnIndex++
		}

		// Fallback: se só houver quick replies, mandar como ButtonsMessage
		if onlyQuickReplies {
			var bts []*waE2E.ButtonsMessage_Button
			idx := 1
			for _, itm := range t.Buttons {
				text := itm.DisplayText
				idtext := itm.Id
				if idtext == "" {
					idtext = strconv.Itoa(idx)
				}
				bts = append(bts, &waE2E.ButtonsMessage_Button{
					ButtonID:       proto.String(idtext),
					ButtonText:     &waE2E.ButtonsMessage_Button_ButtonText{DisplayText: proto.String(text)},
					Type:           waE2E.ButtonsMessage_Button_RESPONSE.Enum(),
					NativeFlowInfo: &waE2E.ButtonsMessage_Button_NativeFlowInfo{},
				})
				idx++
			}
			bm := &waE2E.ButtonsMessage{ContentText: proto.String(t.Content), HeaderType: waE2E.ButtonsMessage_EMPTY.Enum(), Buttons: bts}
			// Alguns ambientes requerem ViewOnce, outros não. Tentar sem, e se der 405, tentar com wrapper.
			msg := &waE2E.Message{ButtonsMessage: bm}
			resp, err := clientManager.GetWhatsmeowClient(txtid).SendMessage(context.Background(), recipient, msg, whatsmeow.SendRequestExtra{ID: msgid})
			if err != nil {
				// retry com ViewOnce
				msg = &waE2E.Message{ViewOnceMessage: &waE2E.FutureProofMessage{Message: &waE2E.Message{ButtonsMessage: bm}}}
				resp, err = clientManager.GetWhatsmeowClient(txtid).SendMessage(context.Background(), recipient, msg, whatsmeow.SendRequestExtra{ID: msgid})
			}
			if err != nil {
				s.Respond(w, r, http.StatusInternalServerError, errors.New(fmt.Sprintf("Error sending message: %v", err)))
				return
			}
			log.Info().Str("timestamp", fmt.Sprintf("%v", resp.Timestamp)).Str("id", msgid).Msg("Buttons sent (fallback quick replies)")
			response := map[string]interface{}{"Details": "Sent", "Timestamp": resp.Timestamp.Unix(), "Id": msgid}
			if responseJson, e := json.Marshal(response); e == nil {
				s.Respond(w, r, http.StatusOK, string(responseJson))
			} else {
				s.Respond(w, r, http.StatusInternalServerError, e)
			}
			return
		}

		hydrated := &waE2E.TemplateMessage_HydratedFourRowTemplate{
			HydratedContentText: proto.String(t.Content),
			HydratedFooterText:  proto.String(t.Footer),
			HydratedButtons:     buttons,
			TemplateID:          proto.String("1"),
		}

		msg := &waE2E.Message{TemplateMessage: &waE2E.TemplateMessage{
			HydratedTemplate: hydrated,
			Format:           &waE2E.TemplateMessage_HydratedFourRowTemplate_{HydratedFourRowTemplate: hydrated},
		}}

		resp, err := clientManager.GetWhatsmeowClient(txtid).SendMessage(context.Background(), recipient, msg, whatsmeow.SendRequestExtra{ID: msgid})
		if err != nil {
			s.Respond(w, r, http.StatusInternalServerError, errors.New(fmt.Sprintf("Error sending message: %v", err)))
			return
		}

		log.Info().Str("timestamp", fmt.Sprintf("%v", resp.Timestamp)).Str("id", msgid).Msg("Message sent")
		response := map[string]interface{}{"Details": "Sent", "Timestamp": resp.Timestamp.Unix(), "Id": msgid}
		responseJson, err := json.Marshal(response)
		if err != nil {
			s.Respond(w, r, http.StatusInternalServerError, err)
		} else {
			s.Respond(w, r, http.StatusOK, string(responseJson))
		}
	}
}
