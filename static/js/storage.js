var API_CONFIG = {
    baseUrl: window.API_BASE_URL || '/api',
    project: window.API_PROJECT || 'ecommerce',
    token: window.API_TOKEN || '',
    writeKey: window.API_WRITE_KEY || ''
};

var _apiInitPromise = null;

async function initAPI() {
    if (API_CONFIG.token) return;
    if (_apiInitPromise) return _apiInitPromise;

    if (window.API_TOKEN) {
        API_CONFIG.token = window.API_TOKEN;
        API_CONFIG.writeKey = window.API_WRITE_KEY || '';
        return;
    }

    _apiInitPromise = (async function() {
        try {
            var res = await fetch(API_CONFIG.baseUrl + '/api/config', {
                headers: { 'Content-Type': 'application/json' }
            });
            if (res.ok) {
                var data = await res.json();
                if (data.token) API_CONFIG.token = data.token;
                if (data.writeKey) API_CONFIG.writeKey = data.writeKey;
                if (data.project) API_CONFIG.project = data.project;
            } else if (res.status === 404) {
                console.warn('[API] Endpoint /api/config n\u00e3o encontrado.');
            }
        } catch (e) {
            console.error('[API] Falha ao obter config:', e);
        }
    })();
    return _apiInitPromise;
}

const generateId = (prefix) => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const apiRequest = async (endpoint, options = {}) => {
    if (!API_CONFIG.token) {
        await initAPI();
    }
    if (!API_CONFIG.token) {
        console.warn('[API] Token n\u00e3o configurado.');
        return null;
    }
    const url = new URL(API_CONFIG.baseUrl + endpoint, window.location.origin);
    if (options.params) {
        Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const fetchOptions = {
        method: options.method || 'GET',
        headers: {
            'Authorization': `Bearer ${API_CONFIG.token}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    };
    if (API_CONFIG.writeKey && ['POST', 'PUT', 'DELETE'].includes(options.method || 'GET')) {
        fetchOptions.headers['X-Write-Key'] = API_CONFIG.writeKey;
    }
    if (options.body) {
        fetchOptions.body = options.body;
    }
    try {
        const res = await fetch(url.toString(), fetchOptions);
        return await res.json();
    } catch (e) {
        console.error(`API request failed: ${endpoint}`, e);
        return null;
    }
};

const DataSync = {
    _cachedData: {},
    _loaded: false,

    async fetchFromAPI(entity) {
        try {
            const url = `${API_CONFIG.baseUrl}/data/${entity}`;
            const result = await apiRequest(`/data/${entity}`, {
                method: 'GET'
            });
            return Array.isArray(result) ? result : (result?.data || []);
        } catch (e) {
            console.error(`Erro ao buscar ${entity} da API:`, e);
            return [];
        }
    },

    async saveToAPI(entity, item) {
        try {
            const cleanItem = { ...item };
            delete cleanItem._entity;

            const body = {
                project: API_CONFIG.project,
                table: entity,
                data: cleanItem
            };
            const result = await apiRequest('/api/create', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            return result?.success ? result.data : null;
        } catch (e) {
            console.error(`Erro ao salvar ${entity} na API:`, e);
            return null;
        }
    },

    async updateToAPI(entity, id, data) {
        try {
            const cleanData = { ...data };
            delete cleanData._entity;

            const body = {
                project: API_CONFIG.project,
                table: entity,
                id: id,
                data: cleanData
            };
            const result = await apiRequest('/api/update', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            return result?.success ? result.data : null;
        } catch (e) {
            console.error(`Erro ao atualizar ${entity} na API:`, e);
            return null;
        }
    },

    async deleteToAPI(entity, id) {
        try {
            const result = await apiRequest('/api/delete', {
                method: 'POST',
                body: JSON.stringify({
                    project: API_CONFIG.project,
                    table: entity,
                    id: id
                })
            });
            return result.success;
        } catch (e) {
            console.error(`Erro ao excluir ${entity} da API:`, e);
            return false;
        }
    },

    async loadAll() {
        const entities = ['produtos', 'carrinhos', 'pedidos', 'contatos'];
        for (const entity of entities) {
            this._cachedData[entity] = await this.fetchFromAPI(entity);
        }
        this._loaded = true;
        return this._cachedData;
    },

    async loadEntity(entity) {
        if (!this._cachedData[entity]) {
            this._cachedData[entity] = await this.fetchFromAPI(entity);
        }
        return this._cachedData[entity] || [];
    },

    async getAll(entity) {
        if (!this._loaded) {
            await this.loadAll();
        }
        return this._cachedData[entity] || [];
    },

    async save(item) {
        const entity = item._entity || 'produtos';

        if (!item.id) {
            item.id = generateId(entity);
        }
        if (!item.created_at) {
            item.created_at = new Date().toISOString();
        }

        const saved = await this.saveToAPI(entity, item);
        if (saved) {
            if (!this._cachedData[entity]) {
                this._cachedData[entity] = [];
            }
            this._cachedData[entity].unshift(saved);
            return saved;
        }

        if (!this._cachedData[entity]) {
            this._cachedData[entity] = [];
        }
        this._cachedData[entity].unshift(item);
        return item;
    },

    async create(item) {
        return this.save(item);
    },

    async delete(item) {
        const entity = item._entity || 'produtos';
        await this.deleteToAPI(entity, item.id);

        if (this._cachedData[entity]) {
            this._cachedData[entity] = this._cachedData[entity].filter(i => i.id !== item.id);
        }
    },

    async update(id, dados, entity) {
        await this.updateToAPI(entity, id, dados);

        if (this._cachedData[entity]) {
            const idx = this._cachedData[entity].findIndex(item => item.id === id);
            if (idx >= 0) {
                this._cachedData[entity][idx] = { ...this._cachedData[entity][idx], ...dados, updated_at: new Date().toISOString() };
                return this._cachedData[entity][idx];
            }
        }
        return null;
    },

    async getById(entity, id) {
        if (!this._cachedData[entity]) {
            await this.loadEntity(entity);
        }
        return (this._cachedData[entity] || []).find(item => item.id === id);
    },

    async search(entity, term) {
        if (!this._cachedData[entity]) {
            await this.loadEntity(entity);
        }
        const items = this._cachedData[entity] || [];
        const lower = term.toLowerCase();
        return items.filter(item =>
            Object.values(item).some(val =>
                typeof val === 'string' && val.toLowerCase().includes(lower)
            )
        );
    },

    async getByField(entity, field, value) {
        if (!this._cachedData[entity]) {
            await this.loadEntity(entity);
        }
        return (this._cachedData[entity] || []).filter(item => item[field] === value);
    },

    async refresh() {
        this._cachedData = {};
        this._loaded = false;
        return await this.loadAll();
    },

    async refreshEntity(entity) {
        delete this._cachedData[entity];
        return await this.loadEntity(entity);
    }
};

function createEntityStore(entityName) {
    return {
        async init() {
            await DataSync.loadEntity(entityName);
            return this;
        },

        async getAll() {
            return await DataSync.getAll(entityName);
        },

        async save(item) {
            item._entity = entityName;
            return await DataSync.save(item);
        },

        async create(item) {
            item._entity = entityName;
            return await DataSync.create(item);
        },

        async update(id, dados) {
            return await DataSync.update(id, dados, entityName);
        },

        async delete(id) {
            await DataSync.delete({ id, _entity: entityName });
        },

        async getById(id) {
            return await DataSync.getById(entityName, id);
        },

        async search(term) {
            return await DataSync.search(entityName, term);
        },

        async getByField(field, value) {
            return await DataSync.getByField(entityName, field, value);
        },

        async refresh() {
            return await DataSync.refreshEntity(entityName);
        }
    };
}

const ProdutosStore = createEntityStore('produtos');
const CarrinhosStore = createEntityStore('carrinhos');
const PedidosStore = createEntityStore('pedidos');
const ContatosStore = createEntityStore('contatos');

var CarrinhoStore = CarrinhosStore;
var ContatoStore = ContatosStore;

const DataStore = {
    load(key) { return null; },
    save(key, value) { }
};

if (typeof window !== 'undefined') {
    window.DataSync = DataSync;
    window.DataStore = DataStore;
    window.ProdutosStore = ProdutosStore;
    window.CarrinhosStore = CarrinhosStore;
    window.CarrinhoStore = CarrinhoStore;
    window.PedidosStore = PedidosStore;
    window.ContatosStore = ContatosStore;
    window.ContatoStore = ContatoStore;
    window.API_CONFIG = API_CONFIG;
    window.initAPI = initAPI;
    window.hasWriteAccess = !!API_CONFIG.writeKey;
}
