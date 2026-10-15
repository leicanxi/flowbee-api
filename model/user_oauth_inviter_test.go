package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// OAuth 注册（InsertWithTx 路径）必须把邀请人写进 inviter_id，否则被邀请人
// 首次充值后 creditInviterReward 取不到邀请人，邀请奖励永远发不出去。
func TestInsertWithTxBindsInviter(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Exec("DELETE FROM users").Error)

	inviter := User{
		Username:    "oauth-inviter",
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
		AffCode:     "INV1",
	}
	require.NoError(t, DB.Create(&inviter).Error)

	inviterId, err := GetUserIdByAffCode("INV1")
	require.NoError(t, err)
	require.Equal(t, inviter.Id, inviterId)

	invitee := User{
		Username:    "oauth-invitee",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return invitee.InsertWithTx(tx, inviterId)
	}))

	var got User
	require.NoError(t, DB.First(&got, invitee.Id).Error)
	assert.Equal(t, inviterId, got.InviterId)

	// 无邀请码时应保持 0，不能误绑定
	plain := User{
		Username:    "oauth-no-invite",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return plain.InsertWithTx(tx, 0)
	}))
	var gotPlain User
	require.NoError(t, DB.First(&gotPlain, plain.Id).Error)
	assert.Equal(t, 0, gotPlain.InviterId)
}
