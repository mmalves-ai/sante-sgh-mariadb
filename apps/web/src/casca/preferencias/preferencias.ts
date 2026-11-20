// Preferências de interface (tema, densidade, fonte). Até o M05 (SGH_ACESSO_PREFERENCIA pela API), ficam
// no navegador; a leitura é protegida por try/catch e o padrão é "igual ao computador" (ficha, seção 6).
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
  return { tema, densidade, fonteAmpliada, aplicar };
});
