package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// 寄语审核状态。
//
// 首期是「先展示后审核」：pending 也会公开展示，rejected 才隐藏。
// 这样付了钱的人立刻能在名单里看到自己，而不是等审核。
// 状态字段现在就落在表上，是为了以后切换成「先审后展示」或接入
// AI 审核时只改判断条件，不需要改表结构、不需要数据迁移。
const (
	SponsorshipMessageStatusPending  = "pending"
	SponsorshipMessageStatusApproved = "approved"
	SponsorshipMessageStatusRejected = "rejected"
)

// 称号 id。前端按 id 做 i18n 映射，不在后端存中文。
const (
	SponsorshipBadgeEarlySupporter      = "early_supporter"
	SponsorshipBadgeContinuousSupporter = "continuous_supporter"
)

var (
	ErrSponsorshipOrderNotFound      = errors.New("sponsorship order not found")
	ErrSponsorshipOrderStatusInvalid = errors.New("sponsorship order status invalid")
	ErrSponsorshipMessageStatusBad   = errors.New("sponsorship message status invalid")
)

// SponsorshipOrder 一条支持（赞助）订单。
//
// 它与 SubscriptionOrder 同构但不共用表：两者的语义完全不同 ——
// 订阅完成时要建订阅实例、改用户分组，支持完成时什么资产都不产生。
// 共用一张表会让"完成后到底该做什么"变成读 order 时的一堆分支判断。
//
// 注意这里没有 Amount/Quota 字段，这是刻意的：支持不产生额度。
// 支付成功后也不会往 TopUp 表写镜像记录（订阅会写一条 Amount=0 的），
// 因为支持出现在"充值记录"里会显示成"付了钱、额度 +0"，
// 反而制造"我充值了怎么没到账"的困惑。支持记录的去处是 /sponsors 页。
type SponsorshipOrder struct {
	Id     int     `json:"id"`
	UserId int     `json:"user_id" gorm:"index"`
	Money  float64 `json:"money"`

	TradeNo         string `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	Status          string `json:"status"`
	CreateTime      int64  `json:"create_time"`
	CompleteTime    int64  `json:"complete_time"`

	// Anonymous 只影响公开名单：勾选后名单里不出现昵称与头像，
	// 但用户自己的页面和管理员列表仍然看得到真实身份。
	Anonymous bool `json:"anonymous"`

	Message       string `json:"message" gorm:"type:varchar(255);default:''"`
	MessageStatus string `json:"message_status" gorm:"type:varchar(16);default:''"`

	ProviderPayload string `json:"provider_payload" gorm:"type:text"`
}

func (o *SponsorshipOrder) Insert() error {
	if o.CreateTime == 0 {
		o.CreateTime = common.GetTimestamp()
	}
	if o.MessageStatus == "" {
		o.MessageStatus = SponsorshipMessageStatusPending
	}
	return DB.Create(o).Error
}

// CompleteSponsorshipOrder 完成一笔支持订单（幂等）。
//
// 与 CompleteSubscriptionOrder 相比，这里刻意什么都不"兑现"：
// 不加余额、不加额度、不改用户分组、不建订阅实例。
// 复用订阅那套支付管道时唯一必须绕开的就是 CreateUserSubscriptionFromPlanTx ——
// 分组升降级写在那里面，只要不调用它，support 就绝不会碰 users.group。
func CompleteSponsorshipOrder(tradeNo string, providerPayload string, expectedPaymentProvider string, actualPaymentMethod string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logMoney float64
	var logPaymentMethod string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SponsorshipOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSponsorshipOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status == common.TopUpStatusSuccess {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return ErrSponsorshipOrderStatusInvalid
		}
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if providerPayload != "" {
			order.ProviderPayload = providerPayload
		}
		if actualPaymentMethod != "" && order.PaymentMethod != actualPaymentMethod {
			order.PaymentMethod = actualPaymentMethod
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logMoney = order.Money
		logPaymentMethod = order.PaymentMethod
		return nil
	})
	if err != nil {
		return err
	}
	if logUserId > 0 {
		msg := fmt.Sprintf("支持成功，金额: %.2f，支付方式: %s", logMoney, logPaymentMethod)
		RecordLog(logUserId, LogTypeTopup, msg)
	}
	return nil
}

// ExpireSponsorshipOrder 拉起支付失败时把订单置为过期，
// 避免留下永远不会被回调的 pending 单。
func ExpireSponsorshipOrder(tradeNo string, expectedPaymentProvider string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order SponsorshipOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSponsorshipOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status != common.TopUpStatusPending {
			return nil
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		return tx.Save(&order).Error
	})
}

// SponsorEntry 公开名单里的一条。
//
// 刻意不含 userId：匿名条目一旦带上 id，"匿名"就只是前端假装不显示而已，
// 打开网络面板就能对上号。也刻意不含金额与支持次数 —— 名单既不按金额排序，
// 也不展示金额和次数的多寡，避免把"同等感谢"变成一句空话。
type SponsorEntry struct {
	Name      string   `json:"name"`
	Anonymous bool     `json:"anonymous"`
	Message   string   `json:"message"`
	Badges    []string `json:"badges"`
	LastTime  int64    `json:"last_time"`
}

// UserSponsorshipStats 用户自己的支持概况（自己可见，含真实身份与次数）。
type UserSponsorshipStats struct {
	Supported    bool     `json:"supported"`
	SupportCount int64    `json:"support_count"`
	FirstTime    int64    `json:"first_time"`
	LastTime     int64    `json:"last_time"`
	Badges       []string `json:"badges"`
	Anonymous    bool     `json:"anonymous"`
	Message      string   `json:"message"`
}

type sponsorshipAggregate struct {
	UserId       int
	FirstTime    int64
	LastTime     int64
	SupportCount int64
}

type sponsorshipWindowCount struct {
	UserId int
	Cnt    int64
}

type sponsorshipLatest struct {
	UserId        int
	Message       string
	MessageStatus string
	Anonymous     bool
	CompleteTime  int64
}

// SponsorshipContinuousCutoff 返回"持续支持"时间窗的起点时间戳。
func SponsorshipContinuousCutoff() int64 {
	months := operation_setting.GetSponsorshipSetting().SponsorshipContinuousWindowMonths()
	return time.Now().AddDate(0, -months, 0).Unix()
}

// sponsorshipBadges 按用户的首次支持时间与窗口内支持次数算出称号。
//
// 两个称号都必须有区分度，"支持过"本身不发称号 —— 出现在名单里
// 就已经是证明，人人都有等于没有。
func sponsorshipBadges(firstTime int64, windowCount int64) []string {
	s := operation_setting.GetSponsorshipSetting()
	badges := make([]string, 0, 2)
	if s.EarlySupporterDeadline > 0 && firstTime > 0 && firstTime <= s.EarlySupporterDeadline {
		badges = append(badges, SponsorshipBadgeEarlySupporter)
	}
	if windowCount >= int64(s.SponsorshipContinuousMinCount()) {
		badges = append(badges, SponsorshipBadgeContinuousSupporter)
	}
	return badges
}

// sponsorshipDisplayMessage 决定名单上实际展示的那句话。
//
// 空寄语用兜底文案，这样名单里不会出现一格格什么内容都没有的空位。
// 被下架的寄语同样回落到兜底文案而不是留空：留空会在名字下面留出一段
// 空白，看起来像渲染坏了；而"这个人支持过、只是没留下话"本来就有一个
// 中性的说法，用它即可，也不会反过来暗示用户说过什么他没说过的话。
//
// 兜底放在读取时而不是写入时：改了默认文案，历史记录跟着一起变，
// 不需要去批量更新旧数据。
func sponsorshipDisplayMessage(message string, status string) string {
	if status == SponsorshipMessageStatusRejected || message == "" {
		return operation_setting.GetSponsorshipSetting().SponsorshipDefaultMessage()
	}
	return message
}

// sponsorshipUserNames 批量取用户显示名，避免名单渲染时的 N+1 查询。
func sponsorshipUserNames(userIds []int) (map[int]User, error) {
	result := make(map[int]User, len(userIds))
	if len(userIds) == 0 {
		return result, nil
	}
	var users []User
	if err := DB.Select("id", "username", "display_name", "status").
		Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, u := range users {
		result[u.Id] = u
	}
	return result, nil
}

// ListSponsors 返回公开的支持者名单。
//
// 每个用户只出现一次（用他最近一次留下的寄语），按最近支持时间倒序 ——
// 不做金额排行，但保留时间序：每次有人支持，名单头部就会变，
// "还在有人加入"的感觉来自时间，而不是来自金额高下。
//
// 若按订单逐条展开，一个支持了 12 次的人会在墙上占 12 格并刷掉别人，
// 这与"同等感谢"直接冲突，所以这里必须先按用户归并。
func ListSponsors(limit int) ([]SponsorEntry, error) {
	if limit <= 0 {
		limit = 60
	}
	if limit > 200 {
		limit = 200
	}

	var aggregates []sponsorshipAggregate
	if err := DB.Model(&SponsorshipOrder{}).
		Select("user_id, MIN(complete_time) AS first_time, MAX(complete_time) AS last_time, COUNT(*) AS support_count").
		Where("status = ?", common.TopUpStatusSuccess).
		Group("user_id").
		Order("last_time DESC").
		Limit(limit).
		Scan(&aggregates).Error; err != nil {
		return nil, err
	}
	if len(aggregates) == 0 {
		return []SponsorEntry{}, nil
	}

	userIds := make([]int, 0, len(aggregates))
	for _, a := range aggregates {
		userIds = append(userIds, a.UserId)
	}

	// 取每个用户最近一条订单的寄语与匿名标记。按时间倒序扫，首次出现即最新。
	// Limit 是防御性的：正常站点远到不了，但可以让单次查询有界。
	var latestRows []sponsorshipLatest
	if err := DB.Model(&SponsorshipOrder{}).
		Select("user_id, message, message_status, anonymous, complete_time").
		Where("status = ? AND user_id IN ?", common.TopUpStatusSuccess, userIds).
		Order("complete_time DESC, id DESC").
		Limit(limit * 100).
		Scan(&latestRows).Error; err != nil {
		return nil, err
	}
	latestByUser := make(map[int]sponsorshipLatest, len(latestRows))
	for _, row := range latestRows {
		if _, ok := latestByUser[row.UserId]; !ok {
			latestByUser[row.UserId] = row
		}
	}

	// 窗口内支持次数：持续称号依赖它，不能拿总次数代替。
	windowByUser := make(map[int]int64, len(aggregates))
	var windowCounts []sponsorshipWindowCount
	if err := DB.Model(&SponsorshipOrder{}).
		Select("user_id, COUNT(*) AS cnt").
		Where("status = ? AND complete_time >= ? AND user_id IN ?",
			common.TopUpStatusSuccess, SponsorshipContinuousCutoff(), userIds).
		Group("user_id").
		Scan(&windowCounts).Error; err != nil {
		return nil, err
	}
	for _, w := range windowCounts {
		windowByUser[w.UserId] = w.Cnt
	}

	users, err := sponsorshipUserNames(userIds)
	if err != nil {
		return nil, err
	}

	entries := make([]SponsorEntry, 0, len(aggregates))
	for _, a := range aggregates {
		entry := SponsorEntry{
			LastTime: a.LastTime,
			Badges:   sponsorshipBadges(a.FirstTime, windowByUser[a.UserId]),
		}
		user, ok := users[a.UserId]
		// 已注销或已封禁的账号按匿名处理，不再公开其身份。
		if !ok || user.Status != common.UserStatusEnabled {
			entry.Anonymous = true
		} else {
			entry.Name = user.DisplayName
			if entry.Name == "" {
				entry.Name = user.Username
			}
		}
		if latest, ok := latestByUser[a.UserId]; ok {
			if latest.Anonymous {
				entry.Anonymous = true
				entry.Name = ""
			}
			// 匿名只隐藏身份，寄语照常展示：勾了匿名的人写的话
			// 依然是写给这个站看的，不该连带被丢掉。
			entry.Message = sponsorshipDisplayMessage(latest.Message, latest.MessageStatus)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// GetUserSponsorshipStats 返回某个用户自己的支持概况。
func GetUserSponsorshipStats(userId int) (*UserSponsorshipStats, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	stats := &UserSponsorshipStats{Badges: []string{}}

	var aggregate struct {
		FirstTime    int64
		LastTime     int64
		SupportCount int64
	}
	if err := DB.Model(&SponsorshipOrder{}).
		Select("COALESCE(MIN(complete_time), 0) AS first_time, COALESCE(MAX(complete_time), 0) AS last_time, COUNT(*) AS support_count").
		Where("status = ? AND user_id = ?", common.TopUpStatusSuccess, userId).
		Scan(&aggregate).Error; err != nil {
		return nil, err
	}
	stats.SupportCount = aggregate.SupportCount
	stats.FirstTime = aggregate.FirstTime
	stats.LastTime = aggregate.LastTime
	stats.Supported = aggregate.SupportCount > 0

	var windowCount int64
	if err := DB.Model(&SponsorshipOrder{}).
		Where("status = ? AND user_id = ? AND complete_time >= ?",
			common.TopUpStatusSuccess, userId, SponsorshipContinuousCutoff()).
		Count(&windowCount).Error; err != nil {
		return nil, err
	}
	stats.Badges = sponsorshipBadges(aggregate.FirstTime, windowCount)

	var latest SponsorshipOrder
	err := DB.Where("status = ? AND user_id = ?", common.TopUpStatusSuccess, userId).
		Order("complete_time DESC, id DESC").First(&latest).Error
	if err == nil {
		stats.Anonymous = latest.Anonymous
		stats.Message = sponsorshipDisplayMessage(latest.Message, latest.MessageStatus)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return stats, nil
}

// AdminSponsorshipOrder 后台列表用的记录，含真实身份与金额，仅管理员可见。
type AdminSponsorshipOrder struct {
	Id            int     `json:"id"`
	UserId        int     `json:"user_id"`
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	Money         float64 `json:"money"`
	TradeNo       string  `json:"trade_no"`
	PaymentMethod string  `json:"payment_method"`
	Status        string  `json:"status"`
	Anonymous     bool    `json:"anonymous"`
	Message       string  `json:"message"`
	MessageStatus string  `json:"message_status"`
	CreateTime    int64   `json:"create_time"`
	CompleteTime  int64   `json:"complete_time"`
}

// SponsorshipAdminStats 后台列表上方那行汇总。
//
// 只给三个数：支持人次、支持人数、累计金额。刻意不做成独立的概览页 ——
// 这个规模的活动，一张页面上多一行数字就够了，单开一页反而没人看。
type SponsorshipAdminStats struct {
	SupportCount int64   `json:"support_count"`
	SupporterNum int64   `json:"supporter_num"`
	TotalMoney   float64 `json:"total_money"`
}

// ListAdminSponsorshipOrders 后台分页查询支持记录。
// status 为空时返回全部；username 为空时不按用户过滤。
func ListAdminSponsorshipOrders(page int, pageSize int, status string, username string) ([]AdminSponsorshipOrder, int64, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	query := DB.Model(&SponsorshipOrder{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	// 按用户名过滤走子查询而不是 JOIN：赞助记录表本身只存 user_id，
	// 用子查询能同时匹配用户名和显示名，也不必在这里拼接 JOIN 条件。
	if keyword := strings.TrimSpace(username); keyword != "" {
		like := "%" + keyword + "%"
		var userIds []int
		if err := DB.Model(&User{}).
			Where("username LIKE ? OR display_name LIKE ?", like, like).
			Pluck("id", &userIds).Error; err != nil {
			return nil, 0, err
		}
		if len(userIds) == 0 {
			return []AdminSponsorshipOrder{}, 0, nil
		}
		query = query.Where("user_id IN ?", userIds)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var orders []SponsorshipOrder
	if err := query.Order("id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&orders).Error; err != nil {
		return nil, 0, err
	}
	userIds := make([]int, 0, len(orders))
	for _, o := range orders {
		userIds = append(userIds, o.UserId)
	}
	users, err := sponsorshipUserNames(userIds)
	if err != nil {
		return nil, 0, err
	}
	entries := make([]AdminSponsorshipOrder, 0, len(orders))
	for _, o := range orders {
		entry := AdminSponsorshipOrder{
			Id:            o.Id,
			UserId:        o.UserId,
			Money:         o.Money,
			TradeNo:       o.TradeNo,
			PaymentMethod: o.PaymentMethod,
			Status:        o.Status,
			Anonymous:     o.Anonymous,
			Message:       o.Message,
			MessageStatus: o.MessageStatus,
			CreateTime:    o.CreateTime,
			CompleteTime:  o.CompleteTime,
		}
		if user, ok := users[o.UserId]; ok {
			entry.Username = user.Username
			entry.DisplayName = user.DisplayName
		}
		entries = append(entries, entry)
	}
	return entries, total, nil
}

// GetSponsorshipAdminStats 统计已付款的支持记录。
// 只统计 success 状态：pending 的单子还没真正收到钱，算进去会让数字虚高。
func GetSponsorshipAdminStats() (*SponsorshipAdminStats, error) {
	stats := &SponsorshipAdminStats{}
	if err := DB.Model(&SponsorshipOrder{}).
		Select("COUNT(*) AS support_count, COUNT(DISTINCT user_id) AS supporter_num, COALESCE(SUM(money), 0) AS total_money").
		Where("status = ?", common.TopUpStatusSuccess).
		Scan(stats).Error; err != nil {
		return nil, err
	}
	return stats, nil
}

// UpdateSponsorshipMessageStatus 更新寄语审核状态。
func UpdateSponsorshipMessageStatus(id int, status string) error {
	if id <= 0 {
		return errors.New("invalid id")
	}
	switch status {
	case SponsorshipMessageStatusPending, SponsorshipMessageStatusApproved, SponsorshipMessageStatusRejected:
	default:
		return ErrSponsorshipMessageStatusBad
	}
	result := DB.Model(&SponsorshipOrder{}).Where("id = ?", id).Update("message_status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrSponsorshipOrderNotFound
	}
	return nil
}
