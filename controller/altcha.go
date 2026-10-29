package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetAltchaChallenge issues a proof-of-work challenge for the self-hosted
// ALTCHA widget. It is public because the widget fetches it before login or
// registration; the challenge itself carries no secret.
func GetAltchaChallenge(c *gin.Context) {
	if !common.AltchaCheckEnabled {
		c.Status(http.StatusNotFound)
		return
	}
	challenge, err := service.NewAltchaChallenge(common.AltchaHmacKey, common.AltchaMaxNumber)
	if err != nil {
		common.SysError(common.LogText("failed to create ALTCHA challenge: %s", err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, challenge)
}
