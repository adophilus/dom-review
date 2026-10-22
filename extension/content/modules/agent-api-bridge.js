/**
 * DOM Review — Agent API Bridge (MAIN world)
 *
 * Exposes window.__domReviewAPI for programmatic access by AI agents
 * and automation tools. Communicates with the extension's ISOLATED world
 * via custom DOM events (same pattern as framework-bridge.js).
 *
 * Usage (from evaluate_script / DevTools console):
 *   window.__domReviewAPI.getReviews()
 *   window.__domReviewAPI.addComment({ selector: '...', comment: '...' })
 *   window.__domReviewAPI.addReply({ reviewId: '...', comment: '...' })
 *   window.__domReviewAPI.resolveReview('r_...')
 *   window.__domReviewAPI.unresolveReview('r_...')
 */
(function() {
  'use strict';

  var REQUEST_ATTR = 'data-dr-api-request';
  var RESPONSE_ATTR = 'data-dr-api-response';
  var EVENT_NAME = 'dr-api-request';
  var counter = 0;

  function call(method, params) {
    var requestId = 'req_' + (++counter) + '_' + Date.now();
    var request = { requestId: requestId, method: method, params: params || {} };

    document.documentElement.setAttribute(REQUEST_ATTR, JSON.stringify(request));
    document.dispatchEvent(new CustomEvent(EVENT_NAME));

    var raw = document.documentElement.getAttribute(RESPONSE_ATTR);
    document.documentElement.removeAttribute(REQUEST_ATTR);
    document.documentElement.removeAttribute(RESPONSE_ATTR);

    if (!raw) {
      return { success: false, error: 'No response from extension. Is DOM Review loaded?' };
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { success: false, error: 'Invalid response: ' + e.message };
    }
  }

  window.__domReviewAPI = {
    version: '1.0',

    /** Get all reviews for current page */
    getReviews: function() {
      return call('getReviews');
    },

    /** Get a single review by ID */
    getReview: function(reviewId) {
      return call('getReview', { reviewId: reviewId });
    },

    /**
     * Add a new review comment on a DOM element.
     * @param {Object} params
     * @param {string} params.selector  - CSS selector for target element (required)
     * @param {string} params.comment   - Review comment text (required)
     * @param {string} [params.priority] - 'high' | 'medium' | 'low' (default: 'medium')
     * @param {string} [params.category] - 'style' | 'logic' | 'a11y' | 'text' | 'layout' | 'remove' | 'add' (default: 'style')
     */
    addComment: function(params) {
      return call('addComment', params);
    },

    /**
     * Add a reply to an existing review.
     * @param {Object} params
     * @param {string} params.reviewId - ID of parent review (required)
     * @param {string} params.comment  - Reply text (required)
     * @param {string} [params.author] - Author identifier (default: 'agent')
     */
    addReply: function(params) {
      return call('addReply', params);
    },

    /** Mark a review as resolved */
    resolveReview: function(reviewId) {
      return call('resolveReview', { reviewId: reviewId });
    },

    /** Mark a review as unresolved (reopen) */
    unresolveReview: function(reviewId) {
      return call('unresolveReview', { reviewId: reviewId });
    },

    /**
     * Update an existing review's comment, priority, or category.
     * @param {Object} params
     * @param {string} params.reviewId  - ID of review to update (required)
     * @param {string} [params.comment]  - New comment text
     * @param {string} [params.priority] - New priority
     * @param {string} [params.category] - New category
     */
    updateComment: function(params) {
      return call('updateComment', params);
    },

    /** Delete a review by ID */
    deleteReview: function(reviewId) {
      return call('deleteReview', { reviewId: reviewId });
    }
  };

  // Signal that the API is ready
  document.documentElement.setAttribute('data-dr-api-ready', 'true');
})();
