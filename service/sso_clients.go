package service

import (
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/golang-jwt/jwt/v5"
)

// Multi-tenant SSO for relying parties (web front ends) that want "log in with
// FlowBee". Each client gets its own secret and a fixed callback; the browser
// is redirected to that callback with a short-lived signed ticket.
//
// Registry source: the SSO_CLIENTS env var, a JSON object keyed by client id:
//
//	SSO_CLIENTS={"sing":{"name":"音色广场","secret":"…","callback":"https://…/v1/auth/callback"}}
//
// The legacy single-tenant OCTOP_SSO_SECRET / OCTOP_SSO_CALLBACK pair stays
// supported as the client id "octop" (it still serves the /sso/octop relay page
// and /api/user/octop_sso).
const (
	ssoClientsEnv   = "SSO_CLIENTS"
	ssoTicketTTL    = 60 * time.Second
	legacySSOSecret = "OCTOP_SSO_SECRET"
	legacyCallback  = "OCTOP_SSO_CALLBACK"
	legacyClientID  = "octop"
)

// SSOClient is one registered relying party.
type SSOClient struct {
	ID       string `json:"-"`
	Name     string `json:"name"`
	Secret   string `json:"secret"`
	Callback string `json:"callback"`
	Disabled bool   `json:"disabled"`
}

// ValidCallback accepts only absolute http(s) URLs without a fragment, so the
// redirect target can never be influenced by request parameters.
func ValidCallback(raw string) (*url.URL, bool) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.Host == "" || target.Fragment != "" {
		return nil, false
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, false
	}
	return target, true
}

// SSOClients returns the enabled client registry, env-parsed on every call so
// tests and config reloads behave predictably.
func SSOClients() map[string]SSOClient {
	clients := map[string]SSOClient{}
	raw := strings.TrimSpace(common.GetEnvOrDefaultString(ssoClientsEnv, ""))
	if raw != "" {
		var parsed map[string]SSOClient
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			common.SysLog("SSO_CLIENTS is not valid JSON, ignoring: " + err.Error())
		} else {
			for id, client := range parsed {
				id = strings.TrimSpace(id)
				if id == "" || client.Disabled {
					continue
				}
				if strings.TrimSpace(client.Secret) == "" {
					common.SysLog("SSO client " + id + " has no secret, skipping")
					continue
				}
				if _, ok := ValidCallback(client.Callback); !ok {
					common.SysLog("SSO client " + id + " has an invalid callback, skipping")
					continue
				}
				client.ID = id
				client.Secret = strings.TrimSpace(client.Secret)
				clients[id] = client
			}
		}
	}
	if _, ok := clients[legacyClientID]; !ok {
		secret := strings.TrimSpace(common.GetEnvOrDefaultString(legacySSOSecret, ""))
		callback := strings.TrimSpace(common.GetEnvOrDefaultString(legacyCallback, ""))
		if secret != "" {
			if _, valid := ValidCallback(callback); valid {
				clients[legacyClientID] = SSOClient{
					ID:       legacyClientID,
					Name:     "Octop (legacy)",
					Secret:   secret,
					Callback: callback,
				}
			}
		}
	}
	return clients
}

// IssueSSOTicket signs the short-lived identity ticket for one client.
func IssueSSOTicket(client SSOClient, user *model.User) (string, error) {
	name := strings.TrimSpace(user.DisplayName)
	if name == "" {
		name = user.Username
	}
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":      strconv.Itoa(user.Id),
		"username": user.Username,
		"email":    strings.TrimSpace(user.Email),
		"name":     name,
		"aud":      client.ID,
		"exp":      now.Add(ssoTicketTTL).Unix(),
		"iat":      now.Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(client.Secret))
}
