package service

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	altchaAlgorithm        = "SHA-256"
	altchaChallengeTTL     = 10 * time.Minute
	altchaMaxPayloadLength = 4096
	altchaMaxSaltLength    = 128
)

// AltchaChallenge is the ALTCHA v1 challenge document. The widget converts it
// to its internal format, so the JSON field names must match ALTCHA exactly.
type AltchaChallenge struct {
	Algorithm string `json:"algorithm"`
	Challenge string `json:"challenge"`
	Salt      string `json:"salt"`
	MaxNumber int    `json:"maxnumber"`
	Signature string `json:"signature"`
}

type altchaPayload struct {
	Algorithm string `json:"algorithm"`
	Challenge string `json:"challenge"`
	Number    int64  `json:"number"`
	Salt      string `json:"salt"`
	Signature string `json:"signature"`
}

var altchaUsedTokens = struct {
	sync.Mutex
	items map[string]int64
}{items: make(map[string]int64)}

func altchaDigest(input string) string {
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])
}

func altchaSignature(secret string, challenge string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(challenge))
	return hex.EncodeToString(mac.Sum(nil))
}

// NewAltchaChallenge issues a signed challenge whose solution costs the client
// roughly maxNumber/2 SHA-256 hashes: the server picks one counter at random
// within [0, maxNumber) and the widget searches for it.
func NewAltchaChallenge(secret string, maxNumber int) (AltchaChallenge, error) {
	if strings.TrimSpace(secret) == "" {
		return AltchaChallenge{}, errors.New("altcha hmac key is not configured")
	}
	if maxNumber <= 0 {
		return AltchaChallenge{}, errors.New("altcha max number must be positive")
	}

	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		return AltchaChallenge{}, err
	}
	salt := hex.EncodeToString(randomBytes) + "?expires=" + strconv.FormatInt(time.Now().Add(altchaChallengeTTL).Unix(), 10)

	number, err := rand.Int(rand.Reader, big.NewInt(int64(maxNumber)))
	if err != nil {
		return AltchaChallenge{}, err
	}
	challenge := altchaDigest(salt + strconv.FormatInt(number.Int64(), 10))

	return AltchaChallenge{
		Algorithm: altchaAlgorithm,
		Challenge: challenge,
		Salt:      salt,
		MaxNumber: maxNumber,
		Signature: altchaSignature(secret, challenge),
	}, nil
}

// VerifyAltchaPayload validates a base64 payload produced by the ALTCHA widget.
// It returns the challenge id and the remaining validity; the caller still has
// to consume the token so one solution cannot authorize several requests.
func VerifyAltchaPayload(payload string, secret string) (string, time.Duration, error) {
	if strings.TrimSpace(secret) == "" {
		return "", 0, errors.New("altcha hmac key is not configured")
	}
	if payload == "" {
		return "", 0, errors.New("empty altcha payload")
	}
	if len(payload) > altchaMaxPayloadLength {
		return "", 0, errors.New("altcha payload is too large")
	}

	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(payload)
	}
	if err != nil {
		return "", 0, errors.New("altcha payload is not valid base64")
	}
	var data altchaPayload
	if err := common.Unmarshal(raw, &data); err != nil {
		return "", 0, errors.New("altcha payload is not valid json")
	}

	if data.Algorithm != altchaAlgorithm {
		return "", 0, errors.New("unsupported altcha algorithm")
	}
	if len(data.Challenge) != sha256.Size*2 || len(data.Signature) != sha256.Size*2 {
		return "", 0, errors.New("altcha payload has an invalid challenge or signature")
	}
	if len(data.Salt) == 0 || len(data.Salt) > altchaMaxSaltLength {
		return "", 0, errors.New("altcha payload has an invalid salt")
	}
	if data.Number < 0 {
		return "", 0, errors.New("altcha payload has an invalid number")
	}

	actualSignature, err := hex.DecodeString(data.Signature)
	if err != nil {
		return "", 0, errors.New("altcha payload has an invalid signature")
	}
	expectedSignature, err := hex.DecodeString(altchaSignature(secret, data.Challenge))
	if err != nil {
		return "", 0, errors.New("altcha payload has an invalid signature")
	}
	if !hmac.Equal(expectedSignature, actualSignature) {
		return "", 0, errors.New("altcha signature mismatch")
	}

	expiresAt, err := altchaSaltExpiry(data.Salt)
	if err != nil {
		return "", 0, err
	}
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return "", 0, errors.New("altcha challenge has expired")
	}

	actualChallenge, err := hex.DecodeString(data.Challenge)
	if err != nil {
		return "", 0, errors.New("altcha payload has an invalid challenge")
	}
	expectedChallenge, err := hex.DecodeString(altchaDigest(data.Salt + strconv.FormatInt(data.Number, 10)))
	if err != nil {
		return "", 0, errors.New("altcha payload has an invalid challenge")
	}
	if !hmac.Equal(expectedChallenge, actualChallenge) {
		return "", 0, errors.New("altcha solution mismatch")
	}

	return strings.ToLower(data.Challenge), ttl, nil
}

func altchaSaltExpiry(salt string) (time.Time, error) {
	_, query, ok := strings.Cut(salt, "?")
	if !ok {
		return time.Time{}, errors.New("altcha salt has no expiry")
	}
	values, err := url.ParseQuery(query)
	if err != nil {
		return time.Time{}, errors.New("altcha salt has an invalid query")
	}
	raw := values.Get("expires")
	if raw == "" {
		return time.Time{}, errors.New("altcha salt has no expiry")
	}
	seconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Time{}, errors.New("altcha salt has an invalid expiry")
	}
	return time.Unix(seconds, 0), nil
}

// ConsumeAltchaToken records a solved challenge so it can authorize exactly one
// request. Redis is used when available so the guarantee holds across instances.
func ConsumeAltchaToken(challenge string, ttl time.Duration) bool {
	if challenge == "" || ttl <= 0 {
		return false
	}

	if common.RedisEnabled && common.RDB != nil {
		ok, err := common.RedisSetNX("altcha:used:"+challenge, "1", ttl)
		if err == nil {
			return ok
		}
		common.SysError(fmt.Sprintf("altcha replay cache failed: %s", err.Error()))
	}

	now := time.Now().Unix()
	altchaUsedTokens.Lock()
	defer altchaUsedTokens.Unlock()
	for key, expiresAt := range altchaUsedTokens.items {
		if expiresAt <= now {
			delete(altchaUsedTokens.items, key)
		}
	}
	if expiresAt, ok := altchaUsedTokens.items[challenge]; ok && expiresAt > now {
		return false
	}
	altchaUsedTokens.items[challenge] = now + int64(ttl/time.Second) + 1
	return true
}
