import { createRoot } from 'react-dom/client'
import App from './App'
import { canonicalUrl } from './lib/origin'
import './styles.css'

// 在 127.0.0.1 上不渲染，直接跳到 localhost，避免在第二个来源下新建数据库。
const target = canonicalUrl(location.href)
if (target) location.replace(target)
else createRoot(document.getElementById('root')!).render(<App />)
