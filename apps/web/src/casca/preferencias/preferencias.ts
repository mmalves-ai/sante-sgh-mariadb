// Preferências de interface (tema, densidade, fonte). A fonte é a conta (01-ADM L84, preferencias-servidor.ts):
// a escolha feita na tela de preferências é gravada na conta e aplicada ao entrar em qualquer computador; o
// navegador guarda a cópia para abrir sem piscar (leitura protegida por try/catch, padrão "igual ao computador").
import { CLASSE_ESCURO, CLASSE_FONTE_AMPLIADA, DENSIDADES, classeDensidade, type Densidade } from '@sgh/ui';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Tema = 'claro' | 'escuro' | 'sistema';
export type DensidadeEscolhida = Exclude<Densidade, 'painel'>;

export interface Preferencias {
  readonly tema: Tema;
  readonly densidade: DensidadeEscolhida;
  readonly fonteAmpliada: boolean;
}

export const CHAVE_ARMAZENAMENTO = 'sgh.preferencias.v1';
export const PADRAO: Preferencias = { tema: 'sistema', densidade: 'compacta', fonteAmpliada: false };

export function lerPreferencias(
  armazenamento: () => Storage | null = () => window.localStorage,
): Preferencias {
  try {
    const bruto = armazenamento()?.getItem(CHAVE_ARMAZENAMENTO);
    if (!bruto) return PADRAO;
    const p = JSON.parse(bruto) as Partial<Preferencias>;
    return {
      tema: p.tema === 'claro' || p.tema === 'escuro' || p.tema === 'sistema' ? p.tema : PADRAO.tema,
      densidade: p.densidade === 'compacta' || p.densidade === 'confortavel' ? p.densidade : PADRAO.densidade,
      fonteAmpliada: typeof p.fonteAmpliada === 'boolean' ? p.fonteAmpliada : PADRAO.fonteAmpliada,
    };
  } catch {
    return PADRAO;
  }
}

export function gravarPreferencias(
  p: Preferencias,
  armazenamento: () => Storage | null = () => window.localStorage,
): boolean {
  try {
    armazenamento()?.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Aplica as preferências às classes da raiz do documento. */
export function aplicarPreferencias(p: Preferencias, raiz: HTMLElement, sistemaEscuro: boolean): void {
  const escuro = p.tema === 'escuro' || (p.tema === 'sistema' && sistemaEscuro);
  raiz.classList.toggle(CLASSE_ESCURO, escuro);
  for (const d of DENSIDADES) raiz.classList.toggle(classeDensidade(d), d === p.densidade);
  raiz.classList.toggle(CLASSE_FONTE_AMPLIADA, p.fonteAmpliada);
}

export const usarPreferencias = defineStore('preferencias', () => {
  const inicial = lerPreferencias();
  const tema = ref<Tema>(inicial.tema);
  const densidade = ref<DensidadeEscolhida>(inicial.densidade);
  const fonteAmpliada = ref(inicial.fonteAmpliada);
  const consulta =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function aplicar(): void {
    const p = { tema: tema.value, densidade: densidade.value, fonteAmpliada: fonteAmpliada.value };
    aplicarPreferencias(p, document.documentElement, consulta?.matches ?? false);
    gravarPreferencias(p);
  }
  consulta?.addEventListener('change', aplicar);
  watch([tema, densidade, fonteAmpliada], aplicar);
  aplicar();
  /** Troca as três de uma vez (preferências lidas da conta), sem gravar de volta na conta. */
  function substituir(p: Preferencias): void {
    tema.value = p.tema;
    densidade.value = p.densidade;
    fonteAmpliada.value = p.fonteAmpliada;
  }
  return { tema, densidade, fonteAmpliada, aplicar, substituir };
});
