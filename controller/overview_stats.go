package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

// overviewStatsWindowDays 与前端卡片的「近 30 天」保持一致。改动这里要同时
// 改前端文案，否则会出现「数字是 30 天、文案写 7 天」的错位。
const overviewStatsWindowDays = 30

// GetOverviewStats 返回概览「开始使用」卡片需要的两个金额口径。
//
// 只读 master 预聚合的 user_usage_daily_stats：概览会被反复打开，不能每次都
// 去扫 30 天日志（福利分组的分组倍率是 0，真实价值还必须解析 logs.other）。
// 数值单位是 quota，前端用 formatQuota 渲染，货币符号由站点配置决定。
func GetOverviewStats(c *gin.Context) {
	userId := c.GetInt("id")
	summary, err := model.GetOverviewStatsSummary(userId, overviewStatsWindowDays)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 赠送额度读审计日志，失败只是注解缺数字，不能连带把 30 天的汇总也搞掉。
	giftQuota, giftErr := model.GetUserGiftQuota(userId)
	if giftErr != nil {
		giftQuota = 0
	}
	subsidyDiscount := overviewSubsidyDiscount()
	totalModelCount := overviewSubsidyModelCount()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"days":          overviewStatsWindowDays,
			"welfare_value": summary.WelfareValue,
			"subsidy_value": summary.SubsidyValue,
			// 前端要按这个分组名去数「有多少免费模型真的可用」，分组名是配置项，
			// 不能在前端写死。
			"welfare_group": setting.GetWelfarePointsGroup(),
			// 累计赠送额度（管理员手动加过的额度总和）。失败不影响整张卡片，
			// 降级成 0 即可 —— 这行只是注解，不是主数字。
			"gift_quota": giftQuota,
			// 最优惠的补贴折扣（例如 0.3 表示 3 折）。0 表示没有可用的补贴分组，
			// 前端据此隐藏这一行，而不是显示「最高补贴至 0 折」。
			"subsidy_discount": subsidyDiscount,
			// 全站可用模型总数，用于「（N 个可用）」补充说明。
			"total_model_count": totalModelCount,
		},
	})
}

// overviewSubsidyModelCount 返回全站可用模型总数（去重、只算 enabled）。
//
// 这里刻意不按补贴分组去数：一个是每次打开概览都要多查 N 次 abilities，
// 另一个是「最高补贴至 3 折」讲的是这个折扣的力度，和「能用在多少个模型上」
// 其实是同一件事的两种说法，用全站总量更不容易让用户以为被限制在某个分组。
func overviewSubsidyModelCount() int {
	return len(model.GetEnabledModels())
}
// overviewSubsidyDiscount 返回补贴分组里最低的分组倍率，即用户能拿到的最好折扣。
//
// 只认 setting 里配置的 SubsidyGroups：站内可能还有别的低价分组（活动价、
// 内测分组），那些不算「补贴」，把它们的倍率算进来会把数字说小（显得更便宜）。
// 倍率 0 的分组要排除 —— 那是免费分组（福利积分分组），不是「打几折」。
func overviewSubsidyDiscount() float64 {
	best := 0.0
	for _, name := range setting.GetWelfarePointsSubsidyGroups() {
		ratio := ratio_setting.GetGroupRatio(name)
		if ratio <= 0 || ratio >= 1 {
			continue
		}
		if best == 0 || ratio < best {
			best = ratio
		}
	}
	return best
}
