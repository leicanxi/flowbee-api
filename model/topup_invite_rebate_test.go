package model

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func confirmPaymentComplianceForRebateTest(t *testing.T) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
}

// rebateTestUserSeq 让同一测试内多次建号不撞 users 表的唯一索引。
var rebateTestUserSeq atomic.Int32

func createRebateTestUsers(t *testing.T, inviterQuota int) (inviter User, invitee User) {
	t.Helper()
	seq := rebateTestUserSeq.Add(1)
	inviter = User{Username: fmt.Sprintf("rebate-inviter-%d", seq), AffCode: fmt.Sprintf("rbt%d", seq), Status: 1, Role: 1, Group: "default", AuthVersion: 1, Quota: inviterQuota}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee = User{Username: fmt.Sprintf("rebate-invitee-%d", seq), AffCode: fmt.Sprintf("rbe%d", seq), Status: 1, Role: 1, Group: "default", AuthVersion: 1, InviterId: inviter.Id}
	require.NoError(t, DB.Create(&invitee).Error)
	return inviter, invitee
}

func getInviteRebateLogsForTest(t *testing.T, inviterId int) []InviteRebateLog {
	t.Helper()
	var logs []InviteRebateLog
	require.NoError(t, DB.Where("inviter_id = ?", inviterId).Order("id").Find(&logs).Error)
	return logs
}

func TestInviteRebateGrantsBalanceOnFirstTopUp(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"invitee_points":3,"inviter_points":7,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATEGRANT", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	assert.Equal(t, 50000, getUserQuotaForPaymentGuardTest(t, inviter.Id), "inviter earns 5% of the 1,000,000 credited quota")
	assert.Equal(t, 1000000, getUserQuotaForPaymentGuardTest(t, invitee.Id))

	_, permanent, err := GetWelfarePointsBalance(invitee.Id)
	require.NoError(t, err)
	assert.Equal(t, 3, permanent, "invitee keeps earning first top-up points")

	logs := getInviteRebateLogsForTest(t, inviter.Id)
	require.Len(t, logs, 1)
	assert.Equal(t, order.Id, logs[0].TopupId)
	assert.Equal(t, invitee.Id, logs[0].InviteeId)
	assert.Equal(t, 50000, logs[0].Amount)
	assert.Equal(t, InviteRebateStatusGranted, logs[0].Status)

	inviterPointsCount, err := CountWelfarePointLogsBySource(inviter.Id, WelfarePointsSourceInviter)
	require.NoError(t, err)
	assert.Equal(t, 0, inviterPointsCount, "rebate mode must not also grant inviter points")
}

func TestInviteRebateIsIdempotentAndLimitedToFirstTopUp(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order1 := createEpayTestOrder(t, invitee.Id, "EPAYREBATEIDEM1", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order1.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 50000, getUserQuotaForPaymentGuardTest(t, inviter.Id))

	alreadyDone, err = RechargeEpay(order1.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	assert.Equal(t, 50000, getUserQuotaForPaymentGuardTest(t, inviter.Id), "a duplicate callback must not grant twice")

	order2 := createEpayTestOrder(t, invitee.Id, "EPAYREBATEIDEM2", PaymentProviderEpay, common.TopUpStatusPending)
	_, err = RechargeEpay(order2.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.Equal(t, 50000, getUserQuotaForPaymentGuardTest(t, inviter.Id), "only the invitee's first top-up earns a rebate")
	assert.Equal(t, 2000000, getUserQuotaForPaymentGuardTest(t, invitee.Id))

	assert.Len(t, getInviteRebateLogsForTest(t, inviter.Id), 1)
}

func TestInviteRebateAppliesPerOrderCap(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5,"inviter_rebate_max_quota":10000}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATECAP", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	assert.Equal(t, 10000, getUserQuotaForPaymentGuardTest(t, inviter.Id), "the per-order cap bounds the 50,000 rebate")
	logs := getInviteRebateLogsForTest(t, inviter.Id)
	require.Len(t, logs, 1)
	assert.Equal(t, 10000, logs[0].Amount)
}

func TestInviteRebateRoundsWalletConversion(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 1
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	testCases := []struct {
		name        string
		amount      int64
		wantRebate  int
		wantLogRows int
	}{
		{name: "half rounds away from zero", amount: 11, wantRebate: 1, wantLogRows: 1}, // 11 × 5% = 0.55
		{name: "sub-unit rebate grants nothing", amount: 9, wantRebate: 0, wantLogRows: 0},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			inviter, invitee := createRebateTestUsers(t, 0)
			order := createEpayTestOrder(t, invitee.Id, "EPAYREBATEROUND-"+tc.name, PaymentProviderEpay, common.TopUpStatusPending)
			require.NoError(t, DB.Model(&TopUp{}).Where("id = ?", order.Id).Update("amount", tc.amount).Error)

			_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
			require.NoError(t, err)

			assert.Equal(t, tc.wantRebate, getUserQuotaForPaymentGuardTest(t, inviter.Id))
			assert.Len(t, getInviteRebateLogsForTest(t, inviter.Id), tc.wantLogRows)
		})
	}
}

func TestInviteRebateDisabledFallsBackToInviterPoints(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"invitee_points":3,"inviter_points":7}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATEPOINTS", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, inviter.Id), "points mode must not credit wallet balance")
	_, permanent, err := GetWelfarePointsBalance(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 7, permanent, "inviter_points are granted when the rebate is off")

	inviterPointsCount, err := CountWelfarePointLogsBySource(inviter.Id, WelfarePointsSourceInviter)
	require.NoError(t, err)
	assert.Equal(t, 1, inviterPointsCount)
	assert.Empty(t, getInviteRebateLogsForTest(t, inviter.Id))
}

func TestInviteRebateRequiresPaymentCompliance(t *testing.T) {
	setupUserUpdateTestState(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATECOMPL", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	assert.Equal(t, 1000000, getUserQuotaForPaymentGuardTest(t, invitee.Id), "the top-up itself is unaffected")
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, inviter.Id))
	assert.Empty(t, getInviteRebateLogsForTest(t, inviter.Id))
}

func TestClawbackInviteRebateDeductsAndIsIdempotent(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATECLAW", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	require.Equal(t, 50000, getUserQuotaForPaymentGuardTest(t, inviter.Id))

	deducted, err := ClawbackInviteRebate(order.Id)
	require.NoError(t, err)
	assert.Equal(t, 50000, deducted)
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, inviter.Id))

	logs := getInviteRebateLogsForTest(t, inviter.Id)
	require.Len(t, logs, 1)
	assert.Equal(t, InviteRebateStatusClawedBack, logs[0].Status)
	assert.NotZero(t, logs[0].ClawedAt)

	deducted, err = ClawbackInviteRebate(order.Id)
	require.NoError(t, err)
	assert.Equal(t, 0, deducted, "a repeat clawback must not deduct twice")
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, inviter.Id))
}

func TestClawbackInviteRebateNeverGoesNegative(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, 0)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATEFLOOR", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	// 邀请人已花掉大部分余额，扣回只扣到 0 为止。
	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Update("quota", 200).Error)

	deducted, err := ClawbackInviteRebate(order.Id)
	require.NoError(t, err)
	assert.Equal(t, 200, deducted)
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, inviter.Id), "clawback must floor at zero")
}

func TestInviteRebateSkippedWhenInviterWalletAtCeiling(t *testing.T) {
	setupUserUpdateTestState(t)
	confirmPaymentComplianceForRebateTest(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"inviter_rebate_percent":5}`)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	inviter, invitee := createRebateTestUsers(t, common.MaxWalletQuota)
	order := createEpayTestOrder(t, invitee.Id, "EPAYREBATECEIL", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err, "a full inviter wallet must not fail the invitee's top-up")

	assert.Equal(t, 1000000, getUserQuotaForPaymentGuardTest(t, invitee.Id))
	assert.Equal(t, common.MaxWalletQuota, getUserQuotaForPaymentGuardTest(t, inviter.Id))
	assert.Empty(t, getInviteRebateLogsForTest(t, inviter.Id))
}
