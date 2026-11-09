const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function splitChars(element, startIndex = 0) {
  if (element.querySelector('.ch')) return startIndex;
  let index = startIndex;
  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        Array.from(child.textContent).forEach((character) => {
          const span = document.createElement('span');
          span.className = 'ch';
          span.style.setProperty('--i', String(index++));
          span.textContent = character;
          fragment.appendChild(span);
        });
        node.replaceChild(fragment, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    });
  };
  walk(element);
  return index;
}

function mountRoll(element) {
  if (element.querySelector('.roll')) return () => {};
  const label = element.textContent.trim();
  if (!label || element.children.length) return () => {};
  const roll = document.createElement('span');
  roll.className = 'roll';
  roll.setAttribute('aria-hidden', 'true');
  const row = (extra = '') => {
    const wrapper = document.createElement('span');
    wrapper.className = `roll-row ${extra}`.trim();
    Array.from(label).forEach((character, index) => {
      const span = document.createElement('span');
      span.className = 'ch';
      span.style.setProperty('--i', String(index));
      span.textContent = character;
      wrapper.appendChild(span);
    });
    return wrapper;
  };
  roll.append(row(), row('roll-clone'));
  if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', label);
  element.textContent = '';
  element.appendChild(roll);
  element.classList.add('roll-host');
  return () => {};
}

function mountWords(element) {
  const existingWords = Array.from(element.querySelectorAll('.w'));
  if (existingWords.length) return { element, words: existingWords };
  const label = element.textContent.trim();
  element.setAttribute('aria-label', label);
  element.textContent = '';
  const words = label.split(/\s+/).map((word, index, list) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = word;
    element.appendChild(span);
    if (index < list.length - 1) element.appendChild(document.createTextNode(' '));
    return span;
  });
  return { element, words };
}

export function mountMotion() {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const listeners = [];
  const cleanups = [];
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  };

  try {
    root.classList.add('js');
    let wordIndex = 0;
    document.querySelectorAll('[data-split]').forEach((element) => {
      const footer = Boolean(element.closest('[data-footer-mark]'));
      wordIndex = splitChars(element, footer ? 0 : wordIndex);
    });
    document.querySelectorAll('[data-roll]').forEach((element) => {
      cleanups.push(mountRoll(element));
    });

    const wordBlocks = Array.from(document.querySelectorAll('[data-words]'))
      .map(mountWords)
      .filter(Boolean);
    const main = document.querySelector('.site-main');
    if (main && !main.querySelector('.hero')) {
      const targets = main.querySelectorAll(':scope > .page-heading, :scope > .surface, :scope > .form-layout, :scope > .section-block, :scope > .trip-cards, :scope > .route-grid, :scope > .journal-grid');
      targets.forEach((element, index) => {
        if (element.hasAttribute('data-reveal')) return;
        element.setAttribute('data-reveal', '');
        element.style.setProperty('--d', `${Math.min(index, 6) * 70}ms`);
      });
    }

    const revealItems = Array.from(document.querySelectorAll('[data-reveal]'));
    document.querySelectorAll('[data-stagger]').forEach((group) => {
      Array.from(group.children).forEach((child, index) => {
        if (!child.style.getPropertyValue('--d')) child.style.setProperty('--d', `${index * 130}ms`);
        child.querySelectorAll('[data-reveal="img"]').forEach((image) => image.style.setProperty('--d', `${index * 130 + 120}ms`));
      });
    });
    let observer;
    if (reduced || !('IntersectionObserver' in window)) {
      revealItems.forEach((element) => element.classList.add('is-in'));
    } else if (revealItems.length) {
      const watched = new Map();
      revealItems.forEach((element) => {
        const target = element.dataset.reveal === 'img' && element.parentElement ? element.parentElement : element;
        if (!watched.has(target)) watched.set(target, []);
        watched.get(target).push(element);
      });
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (watched.get(entry.target) || []).forEach((element) => element.classList.add('is-in'));
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      watched.forEach((_, target) => observer.observe(target));
    }
    if (observer) cleanups.push(() => observer.disconnect());

    const footerMark = document.querySelector('[data-footer-mark]');
    if (footerMark && !reduced && 'IntersectionObserver' in window) {
      const footerObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          footerMark.classList.add('is-in');
          footerObserver.disconnect();
        });
      }, { threshold: 0.25 });
      footerObserver.observe(footerMark);
      cleanups.push(() => footerObserver.disconnect());
    }

    const header = document.getElementById('site-header');
    const menuToggle = document.getElementById('menu-toggle');
    const menu = document.getElementById('site-menu');
    if (menuToggle && menu) {
      const focusables = () => Array.from(menu.querySelectorAll('a[href], button:not([disabled])'));
      const setOpen = (open) => {
        menuToggle.setAttribute('aria-expanded', String(open));
        menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        menu.classList.toggle('is-open', open);
        menu.setAttribute('aria-hidden', String(!open));
        document.body.classList.toggle('menu-open', open);
        header?.classList.toggle('is-menu-open', open);
        if (open) {
          header?.classList.remove('is-hidden');
          focusables()[0]?.focus({ preventScroll: true });
        }
      };
      listen(menuToggle, 'click', () => setOpen(menuToggle.getAttribute('aria-expanded') !== 'true'));
      listen(menu, 'click', (event) => { if (event.target.closest('a')) setOpen(false); });
      const keyboard = (event) => {
        if (menuToggle.getAttribute('aria-expanded') !== 'true') return;
        if (event.key === 'Escape') { setOpen(false); menuToggle.focus(); return; }
        if (event.key !== 'Tab') return;
        const items = [menuToggle, ...focusables()];
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      listen(document, 'keydown', keyboard);
    }

    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      const y = window.scrollY; const viewportHeight = window.innerHeight;
      if (header) {
        const delta = y - lastY;
        if (Math.abs(delta) > 6 && menuToggle?.getAttribute('aria-expanded') !== 'true') header.classList.toggle('is-hidden', delta > 0 && y > 160);
        if (Math.abs(delta) > 6) lastY = y;
        if (y < 80) header.classList.remove('is-hidden');
      }
      if (reduced) return;
      document.querySelectorAll('[data-parallax]').forEach((element) => {
        const frame = element.parentElement.getBoundingClientRect();
        if (frame.bottom < -100 || frame.top > viewportHeight + 100) return;
        const speed = Number.parseFloat(element.dataset.parallax) || 0.1;
        const offset = (frame.top + frame.height / 2 - viewportHeight / 2) * -speed;
        element.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
      });
      document.querySelectorAll('[data-grow]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        const progress = clamp((viewportHeight * 0.92 - rect.top) / (viewportHeight * 0.75));
        element.style.setProperty('--p', progress.toFixed(3));
      });
      wordBlocks.forEach(({ element, words }) => {
        const rect = element.getBoundingClientRect();
        const progress = clamp((viewportHeight * 0.86 - rect.top) / (viewportHeight * 0.5 + rect.height * 0.6));
        const lit = Math.round(progress * words.length);
        words.forEach((word, index) => word.classList.toggle('on', index < lit));
      });
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    };
    listen(window, 'scroll', onScroll, { passive: true });
    listen(window, 'resize', onScroll, { passive: true });
    update();

    if (!reduced && finePointer) {
      document.querySelectorAll('[data-magnetic]').forEach((element) => {
        let frame = 0;
        const move = (event) => {
          const rect = element.getBoundingClientRect();
          const x = (event.clientX - (rect.left + rect.width / 2)) * 0.22;
          const y = (event.clientY - (rect.top + rect.height / 2)) * 0.32;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => { element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; });
        };
        const leave = () => { cancelAnimationFrame(frame); element.style.transition = 'transform .6s cubic-bezier(.16,.84,.24,1)'; element.style.transform = ''; setTimeout(() => { element.style.transition = ''; }, 600); };
        listen(element, 'pointermove', move);
        listen(element, 'pointerleave', leave);
      });
    }

    const imageError = (event) => {
      if (event.target instanceof HTMLImageElement && event.target.matches('.feature-media img, .hero-frame img')) event.target.remove();
    };
    listen(document, 'error', imageError, true);
    document.querySelectorAll('.feature-media img, .hero-frame img').forEach((image) => { if (image.complete && !image.naturalWidth) image.remove(); });

    return () => {
      listeners.forEach((cleanup) => cleanup());
      cleanups.forEach((cleanup) => cleanup());
      document.body.classList.remove('menu-open', 'is-leaving');
    };
  } catch (error) {
    root.classList.remove('js');
    console.error('EcoTrip motion disabled:', error);
    return () => {};
  }
}