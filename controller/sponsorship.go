package controller

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// 自定义档的保留 id。前端选中它时会额外传一个用户填写的金额。
const sponsorshipCustomTierId = "custom"

type SponsorshipEpayPayRequest struct {
	TierId        string  `json:"tier_id"`
	Money         float64 `json:"money"`
	PaymentMethod string  `json:"payment_method"`
	Anonymous     bool    `json:"anonymous"`
	Message       string  `json:"message"`
}

// SponsorshipTierOption 前端渲染一个金额选项所需的全部信息。
//
// 固定档位与自定义档合成同一个数组下发，前端只需要 map 一遍：
// 四个选项在视觉上就是并列的一排，让它们分两次取数据没有好处。
type SponsorshipTierOption struct {
	Id      string  `json:"id"`
	Label   string  `json:"label"`
	IconUrl string  `json:"icon_url"`
	Money   float64 `json:"money"`
	Custom  bool    `json:"custom"`
}

type SponsorshipInfoResponse struct {
	Enabled          bool                    `json:"enabled"`
	Title            string                  `json:"title"`
	Options          []SponsorshipTierOption `json:"options"`
	CustomMinMoney   float64                 `json:"custom_min_money"`
	CustomMaxMoney   float64                 `json:"custom_max_money"`
	MaxMessageLength int                     `json:"max_message_length"`
	DefaultMessage   string                  `json:"default_message"`
	Sponsors         []model.SponsorEntry    `json:"sponsors"`
}

func buildSponsorshipOptions(setting *operation_setting.SponsorshipSetting) []SponsorshipTierOption {
	options := make([]SponsorshipTierOption, 0, len(setting.Tiers)+1)
	for _, tier := range setting.Tiers {
		// 金额或图标缺失的档位直接跳过：渲染出来是个空白格子，
		// 比少一个选项更糟。
		if tier.Money <= 0 || tier.IconUrl == "" {
			continue
		}
		options = append(options, SponsorshipTierOption{
			Id:      tier.Id,
			Label:   tier.Label,
			IconUrl: tier.IconUrl,
			Money:   tier.Money,
		})
	}
	customLabel := setting.CustomLabel
	if customLabel == "" {
		customLabel = "自定义"
	}
	options = append(options, SponsorshipTierOption{
		Id:      sponsorshipCustomTierId,
		Label:   customLabel,
		IconUrl: setting.CustomIconUrl,
		Custom:  true,
	})
	return options
}

// GetSponsors 公开的支持页数据：选项配置 + 支持者名单。
//
// 不需要登录：名单要让访客和潜在支持者看到才有意义，
// 挂在登录后才可见等于把奖状锁进抽屉。独立首页也是同源直连这个接口。
func GetSponsors(c *gin.Context) {
	setting := operation_setting.GetSponsorshipSetting()
	if !setting.Enabled {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": SponsorshipInfoResponse{
				Enabled:  false,
				Options:  []SponsorshipTierOption{},
				Sponsors: []model.SponsorEntry{},
			},
		})
		return
	}
	sponsors, err := model.ListSponsors(60)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	minMoney, maxMoney := setting.SponsorshipCustomBounds()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": SponsorshipInfoResponse{
			Enabled:          true,
			Title:            setting.Title,
			Options:          buildSponsorshipOptions(setting),
			CustomMinMoney:   minMoney,
			CustomMaxMoney:   maxMoney,
			MaxMessageLength: setting.SponsorshipMaxMessageLength(),
			DefaultMessage:   setting.SponsorshipDefaultMessage(),
			Sponsors:         sponsors,
		},
	})
}

// GetSponsorshipSelf 返回当前用户自己的支持概况（含真实身份与次数，仅自己可见）。
func GetSponsorshipSelf(c *gin.Context) {
	if !operation_setting.IsSponsorshipEnabled() {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    model.UserSponsorshipStats{Badges: []string{}},
		})
		return
	}
	stats, err := model.GetUserSponsorshipStats(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": stats})
}

// resolveSponsorshipMoney 解析并校验本次支持的金额。
//
// 金额一律由服务端决定，客户端传来的数字只在自定义档时才被采信：
// 固定档位的价格从配置里取，客户端改不了；自定义金额走区间校验，
// 构造不出天价订单。
func resolveSponsorshipMoney(setting *operation_setting.SponsorshipSetting, req SponsorshipEpayPayRequest) (float64, error) {
	if strings.TrimSpace(req.TierId) != sponsorshipCustomTierId {
		tier := setting.FindSponsorshipTier(req.TierId)
		if tier == nil {
			return 0, errors.New("支持档位不存在")
		}
		return tier.Money, nil
	}

	money := req.Money
	// NaN 与 ±Inf 都能通过大小比较，必须先单独挡掉。
	if math.IsNaN(money) || math.IsInf(money, 0) {
		return 0, errors.New("金额无效")
	}
	minMoney, maxMoney := setting.SponsorshipCustomBounds()
	if money < minMoney {
		return 0, fmt.Errorf("自定义金额不能低于 %.2f", minMoney)
	}
	if money > maxMoney {
		return 0, fmt.Errorf("自定义金额不能高于 %.2f", maxMoney)
	}
	// 统一到两位小数：网关按分对账，传 10.005 会在对账时对不上。
	return math.Round(money*100) / 100, nil
}

// sanitizeSponsorshipMessage 清洗寄语。
//
// 寄语一律按纯文本处理，不接受 HTML 或 Markdown，前端也只用文本节点渲染。
// 这样彻底没有 XSS 面，不需要引入富文本那套过滤。
// 所有空白（含换行）压成单个空格：名单里每条寄语占一行，多行会撑破排版。
func sanitizeSponsorshipMessage(setting *operation_setting.SponsorshipSetting, raw string) string {
	// 顺序不能反：换行本身就是控制字符，先剔除会把两句话粘成一个词
	// （"加油\n一直用" 变成 "加油一直用"）。所以先按 Unicode 空白切分折叠，
	// 再剔除剩下的控制字符。
	var builder strings.Builder
	for _, r := range strings.Join(strings.Fields(raw), " ") {
		if unicode.IsControl(r) {
			continue
		}
		builder.WriteRune(r)
	}
	// 剔除控制字符会留下连续空格或首尾空格（"a \x00 b"），再折叠一次收尾。
	message := strings.Join(strings.Fields(builder.String()), " ")

	maxLength := setting.SponsorshipMaxMessageLength()
	runes := []rune(message)
	if len(runes) > maxLength {
		message = string(runes[:maxLength])
	}
	return message
}

// SponsorshipRequestEpay 创建一笔支持订单并拉起易支付。
//
// 与订阅下单几乎一致，区别只在落单的表和"完成后做什么"：
// 支持完成时不产生任何资产，也不会碰用户分组。
func SponsorshipRequestEpay(c *gin.Context) {
	setting := operation_setting.GetSponsorshipSetting()
	if !setting.Enabled {
		common.ApiErrorMsg(c, "支持功能未开启")
		return
	}
	if !requirePaymentCompliance(c) {
		return
	}

	var req SponsorshipEpayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	money, err := resolveSponsorshipMoney(setting, req)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorMsg(c, "支付方式不存在")
		return
	}

	callBackAddress := service.GetCallbackAddress()
	returnUrl, err := url.Parse(callBackAddress + "/api/sponsorship/epay/return")
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}
	notifyUrl, err := url.Parse(callBackAddress + "/api/sponsorship/epay/notify")
	if err != nil {
		common.ApiErrorMsg(c, "回调地址配置错误")
		return
	}

	client := GetEpayClient()
	if client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return
	}

	userId := c.GetInt("id")
	tradeNo := fmt.Sprintf("SPUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())

	order := &model.SponsorshipOrder{
		UserId:          userId,
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   req.PaymentMethod,
		PaymentProvider: model.PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
		Anonymous:       req.Anonymous,
		Message:         sanitizeSponsorshipMessage(setting, req.Message),
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}

	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           req.PaymentMethod,
		ServiceTradeNo: tradeNo,
		Name:           fmt.Sprintf("SPONSOR:%.0f", money),
		Money:          strconv.FormatFloat(money, 'f', 2, 64),
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		_ = model.ExpireSponsorshipOrder(tradeNo, model.PaymentProviderEpay)
		common.ApiErrorMsg(c, "拉起支付失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": params, "url": uri})
}

// sponsorshipEpayParams 从 POST body 或 URL query 中取出回调参数。
func sponsorshipEpayParams(c *gin.Context) map[string]string {
	if c.Request.Method == "POST" {
		if err := c.Request.ParseForm(); err != nil {
			return nil
		}
		return lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	}
	return lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
		r[t] = c.Request.URL.Query().Get(t)
		return r
	}, map[string]string{})
}

// SponsorshipEpayNotify 处理易支付的服务器回调。
func SponsorshipEpayNotify(c *gin.Context) {
	params := sponsorshipEpayParams(c)
	if len(params) == 0 {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	client := GetEpayClient()
	if client == nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	LockOrder(verifyInfo.ServiceTradeNo)
	defer UnlockOrder(verifyInfo.ServiceTradeNo)

	if err := model.CompleteSponsorshipOrder(verifyInfo.ServiceTradeNo, common.GetJsonString(verifyInfo), model.PaymentProviderEpay, verifyInfo.Type); err != nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	_, _ = c.Writer.Write([]byte("success"))
}

// SponsorshipEpayReturn 处理用户付完款后浏览器被送回的那一跳。
//
// 这里不做感谢页：验签后直接 302 回支持页，由页面弹一条消息。
// 完成订单也在这里做一次（幂等），因为 notify 与 return 谁先到不保证 ——
// 不这么做，用户落地时可能看到名单里还没有自己。
func SponsorshipEpayReturn(c *gin.Context) {
	params := sponsorshipEpayParams(c)
	if len(params) == 0 {
		c.Redirect(http.StatusFound, paymentReturnPath("/sponsors?pay=fail"))
		return
	}
	client := GetEpayClient()
	if client == nil {
		c.Redirect(http.StatusFound, paymentReturnPath("/sponsors?pay=fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		c.Redirect(http.StatusFound, paymentReturnPath("/sponsors?pay=fail"))
		return
	}
	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		c.Redirect(http.StatusFound, paymentReturnPath("/sponsors?pay=pending"))
		return
	}

	LockOrder(verifyInfo.ServiceTradeNo)
	defer UnlockOrder(verifyInfo.ServiceTradeNo)

	if err := model.CompleteSponsorshipOrder(verifyInfo.ServiceTradeNo, common.GetJsonString(verifyInfo), model.PaymentProviderEpay, verifyInfo.Type); err != nil {
		c.Redirect(http.StatusFound, paymentReturnPath("/sponsors?pay=fail"))
		return
	}
	c.Redirect(http.StatusFound, paymentReturnPath("/sponsors?pay=success"))
}

// AdminListSponsorshipOrders 后台分页查看支持记录（含真实身份与金额）。
func AdminListSponsorshipOrders(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	orders, total, err := model.ListAdminSponsorshipOrders(
		page, pageSize, c.Query("status"), c.Query("username"),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, err := model.GetSponsorshipAdminStats()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":     orders,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
			"stats":     stats,
		},
	})
}

// AdminUpdateSponsorshipMessage 后台处理寄语：通过或下架。
//
// 首期是先展示后审核，所以"通过"只是把状态标回去，
// 真正生效的动作是"下架"（rejected）。
func AdminUpdateSponsorshipMessage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.UpdateSponsorshipMessageStatus(id, strings.TrimSpace(req.Status)); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "success"})
}
