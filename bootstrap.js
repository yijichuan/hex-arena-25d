(() => {
  const panel = document.querySelector('#championModal .champion-panel');
  document.body.dataset.startup = 'loading';

  if (location.protocol === 'file:') {
    document.body.dataset.startup = 'file';
    panel.classList.add('startup-panel');
    panel.innerHTML = `
      <div class="upgrade-kicker">HEX ARENA · 本地启动</div>
      <h2>请用启动器打开游戏</h2>
      <p>直接双击网页无法加载英雄和模型。请按下面的步骤开始：</p>
      <ol class="startup-steps">
        <li>将收到的 ZIP 发布包<strong>完整解压</strong>到一个文件夹。</li>
        <li>双击与此网页同目录的 <code>START-GAME.cmd</code>。</li>
        <li>在自动打开的浏览器中选择英雄；游玩期间保持启动窗口开启。</li>
      </ol>
      <div class="startup-note">适用于 Windows 10 / 11，建议使用 Edge 或 Chrome。无需安装 Node.js、Python；素材已包含，可离线游玩。</div>
      <a class="startup-link" href="PLAY-README.txt">查看启动与分享说明</a>`;
    return;
  }

  import('./game3d.js?v=20260930-portable-7').then(() => {
    document.body.dataset.startup = 'ready';
  }).catch(error => {
    document.body.dataset.startup = 'error';
    panel.classList.add('startup-panel');
    panel.innerHTML = `
      <div class="upgrade-kicker">HEX ARENA · 启动未完成</div>
      <h2>游戏加载失败</h2>
      <p>请完整解压发布包，用 START-GAME.cmd 重新启动，并使用支持 WebGL 的新版 Edge 或 Chrome。</p>
      <pre class="startup-error"></pre>
      <button class="ghost-btn" type="button">重新加载</button>`;
    panel.querySelector('.startup-error').textContent = error.message;
    panel.querySelector('button').addEventListener('click', () => location.reload());
    console.error('Game startup failed:', error);
  });
})();
