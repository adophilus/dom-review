/**
 * Widget Review — Orchestrator
 *
 * Final assembly: wires all modules together.
 * Runs last in content_scripts injection order.
 */
(() => {
  'use strict';
  const { store, ui, selector, selectorGen, contextCapture,
          commentPanel, badges, sidebar, exportImport } = window.__domReview;

  // 0. Check if extension is enabled before initializing
  chrome.storage.sync.get('dr_enabled', (result) => {
    if (result.dr_enabled === false) {
      console.log('[Widget Review] Extension is disabled.');
      return;
    }
    bootstrap();
  });

  function bootstrap() {

  // 1. Load persisted reviews
  store.loadFromStorage();

  // 2. Init Shadow DOM UI (toolbar pill, comment card + reviews panel containers)
  ui.init();

  // 3. Render badges for restored reviews (with retries for SPA)
  badges.render();
  // SPA frameworks render async — retry at increasing intervals
  [500, 1000, 2000, 4000].forEach(ms => setTimeout(() => badges.render(), ms));

  // 4. Wire toolbar Select -> selector mode
  ui.onSelectClick(() => {
    sidebar.hide();
    commentPanel.hide();
    selector.toggle();
    ui.setSelectActive(selector.isActive());
  });

  // 5. Wire toolbar Reviews -> reviews panel
  ui.onReviewsClick(() => {
    commentPanel.hide();
    if (selector.isActive()) {
      selector.toggle();
      ui.setSelectActive(false);
    }
    sidebar.toggle();
  });

  // 6. Wire toolbar ⋯ menu Export/Import
  ui.onExportClick(() => exportImport.exportJSON());
  ui.onImportClick(() => exportImport.importJSON());

  // 7. Wire element selection -> comment card
  selector.onSelect((element) => {
    sidebar.hide();
    const selectorData = selectorGen.generate(element);
    const context = contextCapture.capture(element);
    commentPanel.show(element, selectorData, context);
    ui.setSelectActive(false);
  });

  // 8. Wire comment card save -> store
  commentPanel.onSave((formData) => {
    if (formData.isEdit) {
      store.update(formData.editId, {
        selector: formData.selector,
        xpath: formData.xpath,
        comment: formData.comment,
        category: formData.category,
        priority: formData.priority,
        context: formData.context,
      });
    } else {
      store.add({
        id: `r_${Date.now()}`,
        selector: formData.selector,
        xpath: formData.xpath,
        comment: formData.comment,
        priority: formData.priority,
        category: formData.category,
        resolved: false,
        created: new Date().toISOString(),
        updated: null,
        context: formData.context,
        replies: [],
      });
    }
  });

  // 9. Wire comment card cancel -> reset select button
  commentPanel.onCancel(() => {
    ui.setSelectActive(false);
  });

  // 10. React to store changes
  store.onChange((reviews) => {
    badges.render();
    sidebar.render();
    ui.updateBadgeCount(reviews.filter(r => !r.resolved).length);
  });

  // 11. Initial badge count
  ui.updateBadgeCount(store.getAll().filter(r => !r.resolved).length);

  // 12. Handle SPA navigation
  window.addEventListener('popstate', () => {
    badges.cleanup();
    store.loadFromStorage();
    badges.render();
    sidebar.render();
    ui.updateBadgeCount(store.getAll().filter(r => !r.resolved).length);
  });

  console.log('[Widget Review] Extension loaded. Reviews:', store.getAll().length);

  } // end bootstrap
})();
