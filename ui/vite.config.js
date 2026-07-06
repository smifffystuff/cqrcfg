import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url));

function runtimeConfigPlugin() {
  let env;
  return {
    name: 'runtime-config',
    configureServer(server) {
      env = loadEnv('development', resolve(__dirname, '..'), '');
      server.middlewares.use('/config.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`
window.__CQRCFG_ENV__ = '${env.UI_ENV || 'dev'}';
window.__CQRCFG_API_URL__ = '${env.UI_API_URL || '/api'}';
window.__CQRCFG_ACL_CLAIM__ = '${env.OIDC_ACL_CLAIM || 'cqrcfg_acl'}';
window.__CQRCFG_ACL_CACHE_TTL__ = ${env.OIDC_ACL_CACHE_TTL || 300};
window.__CQRCFG_NAME_CLAIM__ = '${env.UI_NAME_CLAIM || 'sub'}';
window.__CQRCFG_USERNAME_CLAIM__ = '${env.UI_USERNAME_CLAIM || 'sub'}';
window.__CQRCFG_GIT_BRANCH__ = '${env.GIT_BRANCH || ''}';
`);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), runtimeConfigPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
