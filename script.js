/**
 * Sophie & Zahi Wedding Website
 * Interactive functionality
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize all components
  initNavigation();
  initScrollEffects();
  initFAQAccordion();
  initAnimations();
  initCarousel();
});

/**
 * Mobile Navigation Toggle
 */
function initNavigation() {
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');

      // Toggle aria-expanded for accessibility
      const isOpen = navLinks.classList.contains('open');
      navToggle.setAttribute('aria-expanded', isOpen);
    });

    // Close mobile menu when clicking a link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

/**
 * Scroll Effects
 * - Add shadow to nav on scroll
 * - Highlight current section in nav
 */
function initScrollEffects() {
  const nav = document.getElementById('nav');

  if (nav) {
    // Add/remove scrolled class based on scroll position
    const handleScroll = () => {
      if (window.scrollY > 50) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    };

    // Throttle scroll events for performance
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    });

    // Initial check
    handleScroll();
  }
}

/**
 * FAQ Accordion
 * Handles expanding/collapsing FAQ items
 */
function initFAQAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');

    if (question) {
      question.addEventListener('click', () => {
        // Check if this item is already open
        const isOpen = item.classList.contains('open');

        // Close all other items (accordion behavior)
        faqItems.forEach(otherItem => {
          if (otherItem !== item) {
            otherItem.classList.remove('open');
          }
        });

        // Toggle current item
        item.classList.toggle('open', !isOpen);
      });

      // Keyboard accessibility
      question.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          question.click();
        }
      });
    }
  });
}

/**
 * Scroll-triggered Animations
 * Animate elements when they come into view
 */
function initAnimations() {
  // Check if IntersectionObserver is supported
  if (!('IntersectionObserver' in window)) {
    return;
  }

  const animatedElements = document.querySelectorAll(
    '.timeline__event, .card, .info-box, .gallery__item, .registry-card'
  );

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -50px 0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  animatedElements.forEach(element => {
    // Set initial state
    element.style.opacity = '0';
    element.style.transform = 'translateY(20px)';
    element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';

    observer.observe(element);
  });
}

/**
 * Smooth scroll to anchor links
 */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const href = this.getAttribute('href');

    // Skip if it's just "#"
    if (href === '#') return;

    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      const navHeight = document.getElementById('nav')?.offsetHeight || 0;
      const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight - 20;

      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });
    }
  });
});

/**
 * Gallery Lightbox (Basic implementation)
 * Opens images in a larger view when clicked
 */
function initGalleryLightbox() {
  const galleryItems = document.querySelectorAll('.gallery__item');

  galleryItems.forEach(item => {
    item.addEventListener('click', () => {
      const img = item.querySelector('img');
      if (!img) return;

      // Create lightbox
      const lightbox = document.createElement('div');
      lightbox.className = 'lightbox';
      lightbox.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: pointer;
        padding: 20px;
      `;

      const lightboxImg = document.createElement('img');
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      lightboxImg.style.cssText = `
        max-width: 90%;
        max-height: 90vh;
        object-fit: contain;
        border-radius: 4px;
      `;

      lightbox.appendChild(lightboxImg);
      document.body.appendChild(lightbox);

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      // Close lightbox on click
      lightbox.addEventListener('click', () => {
        lightbox.remove();
        document.body.style.overflow = '';
      });

      // Close on escape key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          lightbox.remove();
          document.body.style.overflow = '';
          document.removeEventListener('keydown', handleEscape);
        }
      };
      document.addEventListener('keydown', handleEscape);
    });
  });
}

// Initialize lightbox after DOM is ready
document.addEventListener('DOMContentLoaded', initGalleryLightbox);

/**
 * Photo Carousel
 * Auto-rotating carousel showing 3 photos at a time (responsive)
 */
function initCarousel() {
  const carousel = document.getElementById('storyCarousel');
  if (!carousel) return;

  const track = carousel.querySelector('.carousel__track');
  const slides = carousel.querySelectorAll('.carousel__slide');
  const prevBtn = carousel.querySelector('.carousel__btn--prev');
  const nextBtn = carousel.querySelector('.carousel__btn--next');
  const dotsContainer = document.getElementById('carouselDots');

  if (!track || slides.length === 0) return;

  let currentIndex = 0;
  let autoplayInterval = null;
  const autoplayDelay = 4000; // 4 seconds

  // Determine how many slides to show based on screen width
  function getSlidesToShow() {
    if (window.innerWidth <= 600) return 1;
    if (window.innerWidth <= 900) return 2;
    return 3;
  }

  let slidesToShow = getSlidesToShow();
  let maxIndex = Math.max(0, slides.length - slidesToShow);

  // Create dot indicators
  function createDots() {
    dotsContainer.innerHTML = '';
    const numDots = maxIndex + 1;
    for (let i = 0; i < numDots; i++) {
      const dot = document.createElement('button');
      dot.className = 'carousel__dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Go to slide group ${i + 1}`);
      dot.addEventListener('click', () => goToSlide(i));
      dotsContainer.appendChild(dot);
    }
  }

  // Update carousel position
  function updateCarousel() {
    const slideWidth = 100 / slidesToShow;
    const offset = currentIndex * slideWidth;
    track.style.transform = `translateX(-${offset}%)`;

    // Update dots
    const dots = dotsContainer.querySelectorAll('.carousel__dot');
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === currentIndex);
    });

    // Update button visibility
    prevBtn.style.opacity = currentIndex === 0 ? '0.5' : '1';
    nextBtn.style.opacity = currentIndex >= maxIndex ? '0.5' : '1';
  }

  // Navigate to specific slide
  function goToSlide(index) {
    currentIndex = Math.max(0, Math.min(index, maxIndex));
    updateCarousel();
    resetAutoplay();
  }

  // Next slide
  function nextSlide() {
    if (currentIndex >= maxIndex) {
      currentIndex = 0; // Loop back to start
    } else {
      currentIndex++;
    }
    updateCarousel();
  }

  // Previous slide
  function prevSlide() {
    if (currentIndex <= 0) {
      currentIndex = maxIndex; // Loop to end
    } else {
      currentIndex--;
    }
    updateCarousel();
    resetAutoplay();
  }

  // Autoplay functions
  function startAutoplay() {
    if (autoplayInterval) clearInterval(autoplayInterval);
    autoplayInterval = setInterval(nextSlide, autoplayDelay);
  }

  function stopAutoplay() {
    if (autoplayInterval) {
      clearInterval(autoplayInterval);
      autoplayInterval = null;
    }
  }

  function resetAutoplay() {
    stopAutoplay();
    startAutoplay();
  }

  // Event listeners
  prevBtn.addEventListener('click', () => {
    prevSlide();
  });

  nextBtn.addEventListener('click', () => {
    nextSlide();
    resetAutoplay();
  });

  // Pause autoplay on hover
  carousel.addEventListener('mouseenter', stopAutoplay);
  carousel.addEventListener('mouseleave', startAutoplay);

  // Touch/swipe support
  let touchStartX = 0;
  let touchEndX = 0;

  carousel.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    stopAutoplay();
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
    startAutoplay();
  }, { passive: true });

  function handleSwipe() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        nextSlide();
      } else {
        prevSlide();
      }
    }
  }

  // Handle window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const newSlidesToShow = getSlidesToShow();
      if (newSlidesToShow !== slidesToShow) {
        slidesToShow = newSlidesToShow;
        maxIndex = Math.max(0, slides.length - slidesToShow);
        currentIndex = Math.min(currentIndex, maxIndex);
        createDots();
        updateCarousel();
      }
    }, 200);
  });

  // Initialize
  createDots();
  updateCarousel();
  startAutoplay();
}

/**
 * Countdown Timer (optional - can be enabled on home page)
 */
function initCountdown(targetDate) {
  const countdownEl = document.getElementById('countdown');
  if (!countdownEl) return;

  const target = new Date(targetDate).getTime();

  const updateCountdown = () => {
    const now = new Date().getTime();
    const distance = target - now;

    if (distance < 0) {
      countdownEl.innerHTML = '<p>The big day is here!</p>';
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    countdownEl.innerHTML = `
      <div class="countdown__item">
        <span class="countdown__number">${days}</span>
        <span class="countdown__label">Days</span>
      </div>
      <div class="countdown__item">
        <span class="countdown__number">${hours}</span>
        <span class="countdown__label">Hours</span>
      </div>
      <div class="countdown__item">
        <span class="countdown__number">${minutes}</span>
        <span class="countdown__label">Minutes</span>
      </div>
      <div class="countdown__item">
        <span class="countdown__number">${seconds}</span>
        <span class="countdown__label">Seconds</span>
      </div>
    `;
  };

  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// Uncomment to enable countdown:
// initCountdown('September 1, 2026 15:30:00');
