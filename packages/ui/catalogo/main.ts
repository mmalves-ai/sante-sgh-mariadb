import { createApp } from 'vue';
import {
  CLASSE_ESCURO,
  classeDensidade,
  criarI18n,
  instalarUi,
  pacoteDeMarca,
  type Densidade,
} from '../src/index.js';
import CatalogoComponentes from './CatalogoComponentes.vue';

// ?tema=escuro&densidade=confortavel&historia=<id> (usado pela regressão visual).
const parametros = new URLSearchParams(location.search);
const raiz = document.documentElement;
if (parametros.get('tema') === 'escuro') raiz.classList.add(CLASSE_ESCURO);
raiz.classList.add(classeDensidade((parametros.get('densidade') as Densidade | null) ?? 'compacta'));

const app = createApp(CatalogoComponentes, { historia: parametros.get('historia') });
app.use(criarI18n());
instalarUi(app, pacoteDeMarca(parametros.get('marca') ?? 'rede-sante'));
app.mount('#catalogo');
