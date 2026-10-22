/**
 * DOM Review — Agent API Handler (ISOLATED world)
 *
 * Listens for dr-api-request events from the MAIN world bridge,
 * executes operations on window.__domReview.store, and writes
 * responses back via DOM attributes.
 *
 * Depends on: store (Track 1), selectorGen (Track 2), contextCapture (Track 5)
 * Registers: window.__domReview.agentAPI
 */
(() => {
  'use strict';
  window.__domReview = window.__domReview || {};

  const REQUEST_ATTR = 'data-dr-api-request';
  const RESPONSE_ATTR = 'data-dr-api-response';
  const EVENT_NAME = 'dr-api-request';

  const VALID_PRIORITIES = ['high', 'medium', 'low'];
  const VALID_CATEGORIES = ['style', 'logic', 'a11y', 'text', 'layout', 'remove', 'add'];

  function respond(requestId, success, data, error) {
    const response = { requestId, success };
    if (data !== undefined) response.data = data;
    if (error !== undefined) response.error = error;
    document.documentElement.setAttribute(RESPONSE_ATTR, JSON.stringify(response));
  }

  function handleRequest() {
    const raw = document.documentElement.getAttribute(REQUEST_ATTR);
    if (!raw) return;

    let request;
    try {
      request = JSON.parse(raw);
    } catch (e) {
      respond(null, false, undefined, 'Invalid request JSON');
      return;
    }

    const { requestId, method, params } = request;
    const { store } = window.__domReview;

    if (!store) {
      respond(requestId, false, undefined, 'Store not initialized');
      return;
    }

    try {
      switch (method) {
        case 'getReviews': {
          respond(requestId, true, store.toJSON());
          break;
        }

        case 'getReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const review = store.get(params.reviewId);
          if (!review) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true, review);
          }
          break;
        }

        case 'addComment': {
          if (!params.selector || !params.comment) {
            respond(requestId, false, undefined, 'selector and comment are required');
            break;
          }
          const priority = VALID_PRIORITIES.includes(params.priority) ? params.priority : 'medium';
          const category = VALID_CATEGORIES.includes(params.category) ? params.category : 'style';
          const id = `r_${Date.now()}`;

          // Attempt to capture context if element exists
          let context = null;
          let xpath = '';
          try {
            const el = document.querySelector(params.selector);
            if (el) {
              if (window.__domReview.contextCapture) {
                context = window.__domReview.contextCapture.capture(el);
              }
              if (window.__domReview.selectorGen) {
                xpath = window.__domReview.selectorGen.generate(el).xpath;
              }
            }
          } catch { /* invalid selector or element not found */ }

          store.add({
            id,
            selector: params.selector,
            xpath,
            comment: params.comment,
            priority,
            category,
            resolved: false,
            created: new Date().toISOString(),
            updated: null,
            context,
            replies: [],
          });
          respond(requestId, true, { id });
          break;
        }

        case 'addReply': {
          if (!params.reviewId || !params.comment) {
            respond(requestId, false, undefined, 'reviewId and comment are required');
            break;
          }
          const review = store.get(params.reviewId);
          if (!review) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
            break;
          }
          const replyId = `rp_${Date.now()}`;
          const replies = (review.replies || []).slice();
          replies.push({
            id: replyId,
            comment: params.comment,
            author: params.author || 'agent',
            created: new Date().toISOString(),
          });
          store.update(params.reviewId, { replies });
          respond(requestId, true, { reviewId: params.reviewId, replyId });
          break;
        }

        case 'resolveReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const result = store.resolve(params.reviewId);
          if (!result) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true);
          }
          break;
        }

        case 'unresolveReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const result = store.unresolve(params.reviewId);
          if (!result) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true);
          }
          break;
        }

        case 'updateComment': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          const changes = {};
          if (params.comment !== undefined) changes.comment = params.comment;
          if (params.priority !== undefined && VALID_PRIORITIES.includes(params.priority)) {
            changes.priority = params.priority;
          }
          if (params.category !== undefined && VALID_CATEGORIES.includes(params.category)) {
            changes.category = params.category;
          }
          const updated = store.update(params.reviewId, changes);
          if (!updated) {
            respond(requestId, false, undefined, `Review ${params.reviewId} not found`);
          } else {
            respond(requestId, true);
          }
          break;
        }

        case 'deleteReview': {
          if (!params.reviewId) {
            respond(requestId, false, undefined, 'reviewId is required');
            break;
          }
          store.remove(params.reviewId);
          respond(requestId, true);
          break;
        }

        default:
          respond(requestId, false, undefined, `Unknown method: ${method}`);
      }
    } catch (e) {
      respond(requestId, false, undefined, `Internal error: ${e.message}`);
    }
  }

  document.addEventListener(EVENT_NAME, handleRequest);

  window.__domReview.agentAPI = { version: '1.0' };
  console.log('[DOM Review] Agent API handler registered');
})();
