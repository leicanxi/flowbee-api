package service

import (
	"context"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting"
)

// WelfarePointsCostForGroup returns the per-call point cost when the request
// actually uses the configured welfare group. Other groups are never charged.
func WelfarePointsCostForGroup(group string, modelName string) int {
	if group == "" || group != setting.GetWelfarePointsGroup() {
		return 0
	}
	return setting.GetWelfarePointCost(modelName)
}

// ChargeWelfarePoints deducts the configured per-call cost after a successful
// synchronous relay. The request id makes the settlement idempotent. A race
// that exhausts the balance between admission and settlement is logged and
// leaves the balance at zero rather than going negative.
func ChargeWelfarePoints(info *relaycommon.RelayInfo) {
	if info == nil {
		return
	}
	cost := WelfarePointsCostForGroup(info.UsingGroup, info.OriginModelName)
	if cost <= 0 {
		return
	}

	sourceRef := info.RequestId
	if sourceRef == "" {
		sourceRef = fmt.Sprintf("user:%d:%d", info.UserId, info.StartTime.UnixNano())
	}
	ok, err := model.SpendWelfarePoints(info.UserId, cost, model.WelfarePointsSourceRequest, sourceRef)
	if err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("welfare points charge failed: user=%d model=%s cost=%d: %v", info.UserId, info.OriginModelName, cost, err))
		return
	}
	if !ok {
		common.SysError(fmt.Sprintf("welfare points exhausted at settlement: user=%d model=%s cost=%d request=%s", info.UserId, info.OriginModelName, cost, sourceRef))
	}
}
