(() => {
  'use strict';

  const stopGesture = event => event.preventDefault();

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
    document.addEventListener(type, stopGesture, { passive: false });
  });

  document.addEventListener('touchmove', event => {
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  const pinToViewport = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  window.addEventListener('resize', pinToViewport, { passive: true });
  window.addEventListener('orientationchange', () => requestAnimationFrame(pinToViewport), { passive: true });
  document.addEventListener('focusin', () => requestAnimationFrame(pinToViewport));

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', pinToViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', pinToViewport, { passive: true });
  }

  pinToViewport();
})();
