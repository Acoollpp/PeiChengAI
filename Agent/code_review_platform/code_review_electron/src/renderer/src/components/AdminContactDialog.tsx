import adminContactCard from '../assets/admin-contact-card.jpg'

export function AdminContactDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-contact-title">
      <div className="admin-contact-card">
        <button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        <h2 id="admin-contact-title">管理员联系方式</h2>
        <strong>杨慧城</strong>
        <p>深圳市沛城电子科技股份有限公司</p>
        <img src={adminContactCard} alt="钉钉扫码添加管理员好友" />
        <span>用钉钉「扫一扫」二维码，添加我为好友</span>
      </div>
    </div>
  )
}
