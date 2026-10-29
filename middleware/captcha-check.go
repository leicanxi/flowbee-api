package middleware

import (
	"net/http"
	"net/url"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// CaptchaCheck enforces the configured bot-protection provider. Turnstile and
// ALTCHA are mutually exclusive; ALTCHA wins defensively if both flags are set.
func CaptchaCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch {
		case common.AltchaCheckEnabled:
			if !verifyAltcha(c) {
				return
			}
		case common.TurnstileCheckEnabled:
			if !verifyTurnstile(c) {
				return
			}
		}
		c.Next()
	}
}

type turnstileCheckResponse struct {
	Success bool `json:"success"`
}

func verifyTurnstile(c *gin.Context) bool {
	response := c.Query("turnstile")
	if response == "" {
		common.ApiErrorT(c, "Turnstile token is empty")
		c.Abort()
		return false
	}
	rawRes, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", url.Values{
		"secret":   {common.TurnstileSecretKey},
		"response": {response},
		"remoteip": {c.ClientIP()},
	})
	if err != nil {
		common.SysLog(err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		c.Abort()
		return false
	}
	defer rawRes.Body.Close()
	var res turnstileCheckResponse
	err = common.DecodeJson(rawRes.Body, &res)
	if err != nil {
		common.SysLog(err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		c.Abort()
		return false
	}
	if !res.Success {
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		c.Abort()
		return false
	}
	return true
}

func verifyAltcha(c *gin.Context) bool {
	payload := c.Query("altcha")
	if payload == "" {
		// The forms already submit the CAPTCHA slot as "turnstile"; accept it so
		// switching providers does not require changing every API call.
		payload = c.Query("turnstile")
	}
	if payload == "" {
		common.ApiErrorT(c, "ALTCHA token is empty")
		c.Abort()
		return false
	}
	challenge, ttl, err := service.VerifyAltchaPayload(payload, common.AltchaHmacKey)
	if err != nil {
		common.ApiErrorT(c, "ALTCHA verification failed, please refresh and try again!")
		c.Abort()
		return false
	}
	if !service.ConsumeAltchaToken(challenge, ttl) {
		common.ApiErrorT(c, "ALTCHA token has already been used, please refresh and try again!")
		c.Abort()
		return false
	}
	return true
}
