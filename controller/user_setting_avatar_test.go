package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 改造#39：/api/user/setting 走的是 model.UpdateUserSetting，也就是整体替换
// setting JSON。本接口只负责通知与偏好开关，必须把不在本表单里的设置
// （语言 / 边栏 / 扣费偏好 / 头像偏好）原样带过去 —— 否则用户每保存一次
// 通知设置，这些配置就被静默重置回默认。这组测试守住这条。

func setupUserSettingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled := common.RedisEnabled
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	previousTranslate := common.TranslateMessage
	common.RedisEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	// 该 handler 用 ApiSuccessI18n / ApiErrorI18n 响应，而 TranslateMessage 要靠
	// i18n.Init 才赋值；测试里换成直通实现，避免 nil 调用。
	common.TranslateMessage = func(_ *gin.Context, key string, _ ...map[string]any) string {
		return key
	}

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&model.User{}))

	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedisEnabled
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.TranslateMessage = previousTranslate
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func performUpdateUserSettingRequest(t *testing.T, userID int, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/user/setting", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", userID)
	UpdateUserSetting(c)
	return recorder
}

func createUserWithSetting(t *testing.T, db *gorm.DB, username, setting string) model.User {
	t.Helper()
	user := model.User{
		Username: username, Password: "password", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Setting: setting,
	}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func readStoredSetting(t *testing.T, db *gorm.DB, userID int) map[string]any {
	t.Helper()
	var stored model.User
	require.NoError(t, db.First(&stored, userID).Error)
	parsed := map[string]any{}
	if stored.Setting != "" {
		require.NoError(t, common.Unmarshal([]byte(stored.Setting), &parsed))
	}
	return parsed
}

func TestUpdateUserSettingPreservesSettingsOutsideTheForm(t *testing.T) {
	db := setupUserSettingTestDB(t)
	user := createUserWithSetting(t, db, "setting-preserve-user",
		`{"language":"zhCN","sidebar_modules":"{\"chat\":{\"enabled\":true}}",`+
			`"billing_preference":"wallet","avatar_preference":"default"}`)

	recorder := performUpdateUserSettingRequest(t, user.Id,
		`{"notify_type":"webhook","quota_warning_threshold":10,`+
			`"webhook_url":"https://example.com/hook","accept_unset_model_ratio_model":true,"record_ip_log":false}`)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	stored := readStoredSetting(t, db, user.Id)
	assert.Equal(t, "zhCN", stored["language"], "语言偏好不能被通知表单抹掉")
	assert.Equal(t, `{"chat":{"enabled":true}}`, stored["sidebar_modules"], "边栏配置不能被通知表单抹掉")
	assert.Equal(t, "wallet", stored["billing_preference"], "扣费偏好不能被通知表单抹掉")
	assert.Equal(t, "default", stored["avatar_preference"], "未提交头像偏好时应保持原值")
	assert.Equal(t, "webhook", stored["notify_type"])
	assert.EqualValues(t, 10, stored["quota_warning_threshold"])
	assert.Equal(t, "https://example.com/hook", stored["webhook_url"])
	assert.Equal(t, true, stored["accept_unset_model_ratio_model"])
}

func TestUpdateUserSettingAppliesAvatarPreference(t *testing.T) {
	db := setupUserSettingTestDB(t)
	user := createUserWithSetting(t, db, "setting-avatar-user", `{"language":"en"}`)

	recorder := performUpdateUserSettingRequest(t, user.Id,
		`{"notify_type":"email","quota_warning_threshold":5,"avatar_preference":"default"}`)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	stored := readStoredSetting(t, db, user.Id)
	assert.Equal(t, dto.AvatarPreferenceDefault, stored["avatar_preference"])
	assert.Equal(t, "en", stored["language"], "改头像偏好不应影响语言")

	recorder = performUpdateUserSettingRequest(t, user.Id,
		`{"notify_type":"email","quota_warning_threshold":5,"avatar_preference":"oauth"}`)
	assert.Contains(t, recorder.Body.String(), `"success":true`)
	assert.Equal(t, dto.AvatarPreferenceOAuth, readStoredSetting(t, db, user.Id)["avatar_preference"])
}

func TestUpdateUserSettingRejectsInvalidAvatarPreference(t *testing.T) {
	db := setupUserSettingTestDB(t)
	user := createUserWithSetting(t, db, "setting-invalid-avatar-user",
		`{"language":"zhCN","avatar_preference":"oauth"}`)

	recorder := performUpdateUserSettingRequest(t, user.Id,
		`{"notify_type":"email","quota_warning_threshold":5,"avatar_preference":"bogus"}`)
	assert.Contains(t, recorder.Body.String(), `"success":false`)

	stored := readStoredSetting(t, db, user.Id)
	assert.Equal(t, dto.AvatarPreferenceOAuth, stored["avatar_preference"], "非法值不能写库")
	assert.Equal(t, "zhCN", stored["language"])
	assert.Nil(t, stored["notify_type"], "被拒绝的请求不应产生任何写入")
}
