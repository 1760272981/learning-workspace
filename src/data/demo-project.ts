import type { Store } from '../types'

export const DEMO_PROJECT_ID = 'personal-blog'
export const DEMO_PROJECT_NAME = '个人博客网站'

export const demoStore: Store = {
  projects: {
    [DEMO_PROJECT_ID]: {
      days: {},
      outputs: {},
      concepts: [
        {
          id: 'demo-1',
          title: '按共同变更判断该不该提取共用组件',
          kind: 'concept',
          branch: '可维护性',
          created_at: '2026-11-08T10:00:00Z',
          applications: [
            {
              output_ref: 'blog-nav-v1',
              judging: '下一步要给四个页面同时加栏目，判断现在该不该提取共用导航组件',
              evidence: '三个页面各自维护一份相同的导航，加栏目要改三处',
              consequence: '不提取则每次改栏目漏改页面，导航不一致',
              verify_action: '要求 AI 演示改一处导航能否同步各页，并指出哪些页应保留例外',
              sources: [
                { title: 'React 官方：Thinking in React', url: 'https://react.dev/learn/thinking-in-react' },
              ],
              created_at: '2026-11-08T10:00:00Z',
            },
            {
              output_ref: 'portfolio-footer-v2',
              judging: '作品集页脚和博客页脚长得一样，判断要不要合并',
              evidence: '两处页脚结构相同但更新频率不同，博客每周改、作品集半年改',
              consequence: '盲目合并后每次改博客页脚都要回归测试作品集',
              verify_action: '列出两处页脚未来三个月各自的变更计划，确认是否真的共同变更',
              sources: [
                { title: 'React 官方：Passing Props', url: 'https://react.dev/learn/passing-props-to-a-component' },
              ],
              created_at: '2026-11-09T14:00:00Z',
            },
          ],
        },
        {
          id: 'demo-2',
          title: '判断技术债是否该现在偿还',
          kind: 'concept',
          branch: '可维护性',
          created_at: '2026-11-09T09:00:00Z',
          applications: [
            {
              output_ref: 'blog-css-v3',
              judging: 'CSS 已经 800 行且选择器互相覆盖，判断是现在重构还是先加功能',
              evidence: '最近三次改样式都引发了其他页面的意外变化',
              consequence: '继续堆叠会让每次改动的回归成本指数增长',
              verify_action: '让 AI 列出当前 CSS 中互相覆盖的选择器对，评估影响范围后再决定',
              sources: [
                { title: 'MDN：CSS 特异性', url: 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/Specificity' },
              ],
              created_at: '2026-11-09T09:00:00Z',
            },
          ],
        },
        {
          id: 'demo-3',
          title: '判断作品链接能否被未登录访客打开',
          kind: 'operation',
          branch: '发布与验收',
          created_at: '2026-11-10T08:00:00Z',
          applications: [
            {
              output_ref: 'deploy-v1',
              judging: '发布前要确认评委未登录也能打开作品',
              evidence: '部署平台新站点默认私有，不显式改公开则外部访客看到 403',
              consequence: '评委打开是空白或 403，直接失去评审机会',
              verify_action: '用未登录浏览器窗口（隐身模式）打开公网链接确认可访问',
              sources: [
                { title: 'Qoder Sites 文档', url: 'https://docs.qoder.cn/qoder/sites' },
              ],
              created_at: '2026-11-10T08:00:00Z',
            },
          ],
        },
        {
          id: 'demo-4',
          title: '判断写接口是否需要同源保护',
          kind: 'fact',
          branch: '发布与验收',
          created_at: '2026-11-10T09:00:00Z',
          applications: [
            {
              output_ref: 'api-test-v1',
              judging: '前端调后端写接口时，判断请求为什么被 403 拒绝',
              evidence: '网关对写请求强制同源检查，不带 Origin 头的 POST 直接被拦',
              consequence: '不知道这个机制会误以为是权限 bug，浪费时间排查',
              verify_action: '在浏览器控制台发同源 fetch POST 确认通过，再用 curl 不带 Origin 确认被拦',
              sources: [
                { title: 'MDN：Origin 请求头', url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Origin' },
              ],
              created_at: '2026-11-10T09:00:00Z',
            },
          ],
        },
      ],
    },
  },
}
