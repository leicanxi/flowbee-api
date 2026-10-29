package service

import (
	"encoding/base64"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetAltchaReplayCache(t *testing.T) {
	t.Helper()
	altchaUsedTokens.Lock()
	altchaUsedTokens.items = make(map[string]int64)
	altchaUsedTokens.Unlock()
	t.Cleanup(func() {
		altchaUsedTokens.Lock()
		altchaUsedTokens.items = make(map[string]int64)
		altchaUsedTokens.Unlock()
	})
}

func solveAltchaChallenge(t *testing.T, challenge AltchaChallenge) int64 {
	t.Helper()
	for number := int64(0); number < int64(challenge.MaxNumber); number++ {
		if altchaDigest(challenge.Salt+strconv.FormatInt(number, 10)) == challenge.Challenge {
			return number
		}
	}
	t.Fatal("challenge has no solution within max number")
	return -1
}

func encodeAltchaPayload(t *testing.T, secret string, salt string, number int64) string {
	t.Helper()
	challenge := altchaDigest(salt + strconv.FormatInt(number, 10))
	raw, err := common.Marshal(map[string]any{
		"algorithm": altchaAlgorithm,
		"challenge": challenge,
		"number":    number,
		"salt":      salt,
		"signature": altchaSignature(secret, challenge),
		"took":      12,
	})
	require.NoError(t, err)
	return base64.StdEncoding.EncodeToString(raw)
}

func TestAltchaChallengeRoundTripAndReplay(t *testing.T) {
	common.RedisEnabled = false
	resetAltchaReplayCache(t)

	const secret = "altcha-test-secret"
	challenge, err := NewAltchaChallenge(secret, 20000)
	require.NoError(t, err)
	assert.Equal(t, "SHA-256", challenge.Algorithm)
	assert.Greater(t, challenge.MaxNumber, 0)

	number := solveAltchaChallenge(t, challenge)
	payload := encodeAltchaPayload(t, secret, challenge.Salt, number)

	challengeID, ttl, err := VerifyAltchaPayload(payload, secret)
	require.NoError(t, err)
	assert.Equal(t, challenge.Challenge, challengeID)
	assert.Greater(t, ttl, time.Duration(0))

	assert.True(t, ConsumeAltchaToken(challengeID, ttl), "the first use must be accepted")
	assert.False(t, ConsumeAltchaToken(challengeID, ttl), "a reused token must be rejected")
}

func TestAltchaVerifyRejectsTamperingAndExpiry(t *testing.T) {
	common.RedisEnabled = false

	const secret = "altcha-test-secret"
	challenge, err := NewAltchaChallenge(secret, 20000)
	require.NoError(t, err)
	number := solveAltchaChallenge(t, challenge)

	wrongNumberRaw, err := common.Marshal(map[string]any{
		"algorithm": altchaAlgorithm,
		"challenge": challenge.Challenge,
		"number":    number + 1,
		"salt":      challenge.Salt,
		"signature": challenge.Signature,
	})
	require.NoError(t, err)
	_, _, err = VerifyAltchaPayload(base64.StdEncoding.EncodeToString(wrongNumberRaw), secret)
	assert.Error(t, err, "a solution for another counter must not verify")

	wrongSecret := encodeAltchaPayload(t, "another-secret", challenge.Salt, number)
	_, _, err = VerifyAltchaPayload(wrongSecret, secret)
	assert.Error(t, err, "a payload signed with another key must not verify")

	expiredSalt := "deadbeef?expires=" + strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)
	expired := encodeAltchaPayload(t, secret, expiredSalt, 1)
	_, _, err = VerifyAltchaPayload(expired, secret)
	assert.Error(t, err, "an expired challenge must not verify")

	_, _, err = VerifyAltchaPayload("not-base64", secret)
	assert.Error(t, err)

	_, err = NewAltchaChallenge("", 20000)
	assert.Error(t, err, "an empty hmac key must not issue challenges")
}
