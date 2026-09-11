package controller

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// ============================================================================
// 福利抽奖
//
// 改造#12：福利页新增抽奖活动卡。与签到（checkin）的关键差异：
//   - 签到是「每天一次、固定区间随机额度」；抽奖是「固定份数奖池 + 时间平滑发放」
//   - 抽奖的奖品直接入账，不发兑换码（避免产生可流转的凭据与「已发放未兑换」状态）
//
// 机制做成通用的：活动名、奖池、时间窗、分享文案全部可配，换一期活动只改配置。
// ============================================================================

// lotteryTokenHint 把额度折算成 token 数，仅用于前端展示。
//
// 这是零成本的感知放大：额度换算率本身就把数字放大了几十万倍
// （¥1 ≈ 68,493 额度），再折算成 token 后「≈ 1300 万 token」比「¥2」
// 有冲击力得多，而真实成本一分没变。
//
// 单价由 LotteryAnchorPricePerMillion 按真实调用条件推出（deepseek-flash 价 +
// flowbee专属补贴 3 折 + 高缓存），前端必须标出这个口径，保证诚实。
func lotteryTokenHint(quota int, pricePerMillion float64) int64 {
	if quota <= 0 || pricePerMillion <= 0 {
		return 0
	}
	rmb := float64(quota) / common.QuotaPerUnit * operation_setting.USDExchangeRate
	return int64(rmb / pricePerMillion * 1000 * 1000)
}

// lotteryQuotaToRmb 额度折算人民币，用于导出与展示。
func lotteryQuotaToRmb(quota int) float64 {
	return float64(quota) / common.QuotaPerUnit * operation_setting.USDExchangeRate
}

// GetLotteryStatus 获取抽奖活动状态与我的抽奖记录
func GetLotteryStatus(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	if !setting.Enabled {
		common.ApiErrorMsg(c, "抽奖活动未开启")
		return
	}
	userId := c.GetInt("id")
	now := time.Now().Unix()
	roundKey := model.LotteryRoundKey(setting)
	anchorPrice := setting.LotteryAnchorPricePerMillion()

	// 奖池预览：只给档位与面值，**不给剩余份数**。
	//
	// 份数是库存状态，暴露出去有两个坏处：
	//   1. 用户能据此推算「还剩几份」，摸清库存后挑时间刷，而不是正常参与；
	//   2. 奖池缩水会被实时看见，反而削弱活动的期待感。
	// 需要让用户感知「限量」时，用文案和节奏去表达，不要交出精确库存。
	//
	// 另外这里有意不做「永远不会中的展示档位」——奖池里出现的每一档都必须
	// 真的发得出去，否则就是虚假宣传，用户核对后信任直接崩塌。
	prizes := make([]gin.H, 0, len(setting.Prizes))
	for _, p := range setting.Prizes {
		if p.Total <= 0 {
			continue
		}
		prizes = append(prizes, gin.H{
			"id":         p.Id,
			"name":       p.Name,
			"quota":      p.Quota,
			"token_hint": lotteryTokenHint(p.Quota, anchorPrice),
			"amount":     lotteryQuotaToRmb(p.Quota),
		})
	}

	today := time.Now().Format("2006-01-02")
	maxDraws := setting.LotteryMaxDrawsPerUser()
	freeDraws := setting.LotteryFreeDrawsPerUser()
	allowed, shared, err := model.LotteryDrawQuota(setting, userId, roundKey)
	if err != nil {
		common.ApiErrorMsg(c, "获取抽奖次数失败")
		return
	}
	drawnToday, _ := model.CountUserLotteryDraws(userId, roundKey, today)
	drawsLeft := allowed - int(drawnToday)
	if drawsLeft < 0 {
		drawsLeft = 0
	}

	draws, _ := model.GetUserLotteryDraws(userId, roundKey)
	records := make([]gin.H, 0, len(draws))
	for _, d := range draws {
		records = append(records, gin.H{
			"seq":           d.Seq,
			"prize_id":      d.PrizeId,
			"prize_name":    d.PrizeName,
			"quota_awarded": d.QuotaAwarded,
			"token_hint":    lotteryTokenHint(d.QuotaAwarded, anchorPrice),
			"amount":        lotteryQuotaToRmb(d.QuotaAwarded),
			"created_at":    d.CreatedAt,
		})
	}

	status := "running"
	if setting.StartTime > 0 && now < setting.StartTime {
		status = "not_started"
	} else if setting.EndTime <= 0 || now > setting.EndTime {
		status = "ended"
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled":            true,
			"title":              setting.Title,
			"status":             status,
			"start_time":         setting.StartTime,
			"end_time":           setting.EndTime,
			"max_draws_per_user": maxDraws,
			"free_draws":         freeDraws,
			"shared":             shared,
			"draws_used":         drawnToday,
			"draws_left":         drawsLeft,
			"anchor_price":       anchorPrice,
			"share_text":         setting.ShareText,
			"prizes":             prizes,
			"records":            records,
		},
	})
}

// MarkLotteryShare 记录用户的分享动作，解锁剩余的抽奖机会。
//
// 分享无法在服务端验证真伪，所以这里校验的是「用户点过一次分享」。
// 弱校验是刻意的：强行验证分享是否真的发生，成本远高于这点收益，
// 而真正要守住的底线是「不能只靠前端就拿到机会」。
func MarkLotteryShare(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	if !setting.Enabled {
		common.ApiErrorMsg(c, "抽奖活动未开启")
		return
	}
	userId := c.GetInt("id")
	roundKey := model.LotteryRoundKey(setting)

	if _, err := model.MarkLotteryShared(userId, roundKey); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	respondLotteryState(c, setting, userId, roundKey, nil)
}

// respondLotteryState 统一返回「当前剩余次数 + 分享状态」，
// 供抽奖与分享两个接口复用，避免前端在两个接口之间出现状态不一致。
func respondLotteryState(c *gin.Context, setting *operation_setting.LotterySetting, userId int, roundKey string, extra gin.H) {
	today := time.Now().Format("2006-01-02")
	allowed, shared, err := model.LotteryDrawQuota(setting, userId, roundKey)
	if err != nil {
		common.ApiErrorMsg(c, "获取抽奖次数失败")
		return
	}
	drawnToday, _ := model.CountUserLotteryDraws(userId, roundKey, today)
	drawsLeft := allowed - int(drawnToday)
	if drawsLeft < 0 {
		drawsLeft = 0
	}

	data := gin.H{
		"max_draws_per_user": setting.LotteryMaxDrawsPerUser(),
		"free_draws":         setting.LotteryFreeDrawsPerUser(),
		"shared":             shared,
		"draws_used":         drawnToday,
		"draws_left":         drawsLeft,
	}
	for key, value := range extra {
		data[key] = value
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "ok",
		"data":    data,
	})
}

// DoLotteryDraw 执行一次抽奖
func DoLotteryDraw(c *gin.Context) {
	userId := c.GetInt("id")
	setting := operation_setting.GetLotterySetting()

	draw, err := model.UserLotteryDraw(userId)
	if err != nil {
		// 「需要先分享」和「次数已用完」必须区分开返回。
		// 前端据此决定是弹出分享引导，还是直接把按钮置灰。
		code := "draw_failed"
		if errors.Is(err, model.ErrLotteryShareRequired) {
			code = "share_required"
		} else if errors.Is(err, model.ErrLotteryDrawsExhausted) {
			code = "exhausted"
		} else if errors.Is(err, model.ErrLotteryEnded) {
			code = "ended"
		} else if errors.Is(err, model.ErrLotteryNotStarted) {
			code = "not_started"
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"code":    code,
			"message": err.Error(),
		})
		return
	}

	if draw.QuotaAwarded > 0 {
		model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf(
			"福利抽奖第 %d 次，获得「%s」%s",
			draw.Seq, draw.PrizeName, logger.LogQuota(draw.QuotaAwarded)))
	}

	respondLotteryState(c, setting, userId, model.LotteryRoundKey(setting), gin.H{
		"won":           draw.QuotaAwarded > 0,
		"seq":           draw.Seq,
		"prize_id":      draw.PrizeId,
		"prize_name":    draw.PrizeName,
		"quota_awarded": draw.QuotaAwarded,
		"token_hint":    lotteryTokenHint(draw.QuotaAwarded, setting.LotteryAnchorPricePerMillion()),
		"amount":        lotteryQuotaToRmb(draw.QuotaAwarded),
	})
}

// ============================================================================
// 导出（供运营在活动后做「倒霉蛋补偿」）
//
// 注意：这个补偿动作有一条铁律 —— 绝不能提前预告。
// 一旦活动前承诺「没中的也有补偿」，「没中」就变成了保底，
// 抽奖的紧张感当场消失，而且会有人专门奔着补偿来。
// 它必须是事后的意外惊喜，「塞翁失马」才有力量。
// ============================================================================

// ExportLottery 导出抽奖数据 CSV。
//
// type 取值：
//   - winners    中奖明细
//   - losers     倒霉蛋：抽满次数但一次未中（补偿名单）
//   - incomplete 抽了但没抽满次数（需要的是提醒「你还有一次」，不是补偿）
//   - summary    汇总指标
//   - detail     全量明细
func ExportLottery(c *gin.Context) {
	setting := operation_setting.GetLotterySetting()
	roundKey := model.LotteryRoundKey(setting)
	exportType := c.DefaultQuery("type", "detail")
	if exportType == "" {
		exportType = "detail"
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(
		"attachment; filename=lottery_%s_%s.csv", exportType, time.Now().Format("20060102")))

	writer := csv.NewWriter(c.Writer)
	defer writer.Flush()

	// Excel 打开 UTF-8 CSV 需要 BOM，否则中文乱码
	_, _ = c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	formatTime := func(ts int64) string {
		if ts <= 0 {
			return ""
		}
		return time.Unix(ts, 0).Format("2006-01-02 15:04:05")
	}
	formatRmb := func(quota int) string {
		return strconv.FormatFloat(lotteryQuotaToRmb(quota), 'f', 4, 64)
	}

	switch exportType {
	case "winners":
		_ = writer.Write([]string{"user_id", "用户名", "昵称", "奖项", "额度", "≈金额(元)", "抽奖时间"})
		draws, err := model.GetLotteryWinners(roundKey)
		if err != nil {
			common.SysError("export lottery winners failed: " + err.Error())
			return
		}
		usernames, displayNames := loadLotteryUserLabels(draws)
		for _, d := range draws {
			_ = writer.Write([]string{
				strconv.Itoa(d.UserId),
				usernames[d.UserId],
				displayNames[d.UserId],
				d.PrizeName,
				strconv.Itoa(d.QuotaAwarded),
				formatRmb(d.QuotaAwarded),
				formatTime(d.CreatedAt),
			})
		}

	case "losers", "incomplete":
		_ = writer.Write([]string{"user_id", "用户名", "昵称", "抽奖次数", "中奖次数", "获得额度", "最后抽奖时间"})
		stats, err := model.GetLotteryDrawStats(roundKey)
		if err != nil {
			common.SysError("export lottery stats failed: " + err.Error())
			return
		}
		maxDraws := int64(setting.LotteryMaxDrawsPerUser())
		filtered := make([]model.LotteryDrawStat, 0)
		for _, s := range stats {
			if s.WinCount != 0 {
				continue
			}
			if exportType == "losers" && s.DrawCount < maxDraws {
				continue
			}
			if exportType == "incomplete" && s.DrawCount >= maxDraws {
				continue
			}
			filtered = append(filtered, s)
		}
		labels := loadLotteryUserLabelsByStats(filtered)
		for _, s := range filtered {
			_ = writer.Write([]string{
				strconv.Itoa(s.UserId),
				labels[s.UserId][0],
				labels[s.UserId][1],
				strconv.FormatInt(s.DrawCount, 10),
				strconv.FormatInt(s.WinCount, 10),
				strconv.FormatInt(s.TotalQuota, 10),
				formatTime(s.LastDrawAt),
			})
		}

	case "summary":
		_ = writer.Write([]string{"指标", "值"})
		stats, _ := model.GetLotteryDrawStats(roundKey)
		total, remaining, _ := model.GetLotteryStockStats(roundKey)
		var winners, drawCount int64
		var quotaIssued int64
		for _, s := range stats {
			if s.WinCount > 0 {
				winners++
			}
			drawCount += s.DrawCount
			quotaIssued += s.TotalQuota
		}
		budget := 0
		for _, p := range setting.Prizes {
			if p.Total > 0 {
				budget += p.Total * p.Quota
			}
		}
		_ = writer.Write([]string{"参与人数", strconv.Itoa(len(stats))})
		_ = writer.Write([]string{"总抽奖次数", strconv.FormatInt(drawCount, 10)})
		_ = writer.Write([]string{"中奖人数", strconv.FormatInt(winners, 10)})
		_ = writer.Write([]string{"奖池总份数", strconv.Itoa(total)})
		_ = writer.Write([]string{"已发份数", strconv.Itoa(total - remaining)})
		_ = writer.Write([]string{"剩余份数", strconv.Itoa(remaining)})
		_ = writer.Write([]string{"已发额度", strconv.FormatInt(quotaIssued, 10)})
		_ = writer.Write([]string{"已发≈金额(元)", formatRmb(int(quotaIssued))})
		_ = writer.Write([]string{"预算额度", strconv.Itoa(budget)})
		_ = writer.Write([]string{"预算≈金额(元)", formatRmb(budget)})
		hourly, _ := model.GetLotteryHourlyDistribution(roundKey)
		for hour := 0; hour < 24; hour++ {
			if v, ok := hourly[hour]; ok {
				_ = writer.Write([]string{
					fmt.Sprintf("%02d:00-1h发放", hour),
					fmt.Sprintf("%d 份 / %s 元", v["count"], formatRmb(int(v["quota"]))),
				})
			}
		}

	default:
		_ = writer.Write([]string{"user_id", "用户名", "昵称", "第几次", "奖项", "额度", "≈金额(元)", "抽奖时间"})
		var draws []model.LotteryDraw
		if err := model.DB.Where("round_key = ?", roundKey).
			Order("created_at ASC").Find(&draws).Error; err != nil {
			common.SysError("export lottery detail failed: " + err.Error())
			return
		}
		usernames, displayNames := loadLotteryUserLabels(draws)
		for _, d := range draws {
			_ = writer.Write([]string{
				strconv.Itoa(d.UserId),
				usernames[d.UserId],
				displayNames[d.UserId],
				strconv.Itoa(d.Seq),
				d.PrizeName,
				strconv.Itoa(d.QuotaAwarded),
				formatRmb(d.QuotaAwarded),
				formatTime(d.CreatedAt),
			})
		}
	}
}

// loadLotteryUserLabels 批量取用户名与昵称，避免导出时逐条查库。
func loadLotteryUserLabels(draws []model.LotteryDraw) (map[int]string, map[int]string) {
	ids := make([]int, 0, len(draws))
	seen := make(map[int]bool, len(draws))
	for _, d := range draws {
		if !seen[d.UserId] {
			seen[d.UserId] = true
			ids = append(ids, d.UserId)
		}
	}
	return queryLotteryUserLabels(ids)
}

func loadLotteryUserLabelsByStats(stats []model.LotteryDrawStat) map[int][2]string {
	ids := make([]int, 0, len(stats))
	for _, s := range stats {
		ids = append(ids, s.UserId)
	}
	usernames, displayNames := queryLotteryUserLabels(ids)
	result := make(map[int][2]string, len(ids))
	for _, id := range ids {
		result[id] = [2]string{usernames[id], displayNames[id]}
	}
	return result
}

func queryLotteryUserLabels(ids []int) (map[int]string, map[int]string) {
	usernames := make(map[int]string, len(ids))
	displayNames := make(map[int]string, len(ids))
	if len(ids) == 0 {
		return usernames, displayNames
	}
	var users []model.User
	if err := model.DB.Select("id, username, display_name").
		Where("id IN ?", ids).Find(&users).Error; err != nil {
		common.SysError("query lottery user labels failed: " + err.Error())
		return usernames, displayNames
	}
	for _, u := range users {
		usernames[u.Id] = u.Username
		displayNames[u.Id] = u.DisplayName
	}
	return usernames, displayNames
}
