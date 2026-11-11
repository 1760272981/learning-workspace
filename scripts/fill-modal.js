// 用原生 setter 触发 React 受控输入，模拟真实填写三问表单
function setVal(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
const byId = (id) => document.getElementById(id)
setVal(byId('k-title'), '判断部署后是否真的公开可访问')
setVal(byId('k-kind'), 'operation')
setVal(byId('k-branch'), '发布与验收')
setVal(byId('k-output'), 'deploy-check-v1')
setVal(byId('k-judging'), '部署完成后，判断评委在未登录状态能否直接打开作品链接')
setVal(byId('k-evidence'), '平台新站点默认私有，实测隐身窗口打开返回 403')
setVal(byId('k-consequence'), '评委看到 403 或空白，直接失去评审机会')
setVal(byId('k-verify_action'), '用隐身窗口打开公网链接确认 200，再登录确认内容一致')
const srcTitle = document.querySelector('input[aria-label="来源 1 标题"]')
const srcUrl = document.querySelector('input[aria-label="来源 1 链接"]')
setVal(srcTitle, 'Qoder Sites 公开访问文档')
setVal(srcUrl, 'https://docs.qoder.cn/qoder/sites')
JSON.stringify({ filled: true, title: byId('k-title').value })