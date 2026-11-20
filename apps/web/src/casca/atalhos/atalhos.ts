// Atalhos globais, iguais em todos os módulos (cap-03 §3.4; regra 14). Um atalho sem ação na tela atual
// não aparece no painel "?" e não faz nada. "/" e "?" não disparam enquanto se digita num campo.
import { shallowRef } from 'vue';

export const ATALHOS = [
  { id: 'paleta', teclas: 'Ctrl+K', emCampo: true },
  { id: 'busca-lista', teclas: '/', emCampo: false },
  { id: 'salvar-rascunho', teclas: 'F2', emCampo: true },
  { id: 'concluir', teclas: 'Ctrl+Enter', emCampo: true },
  { id: 'nova-prescricao', teclas: 'Alt+P', emCampo: true },
  { id: 'nova-evolucao', teclas: 'Alt+E', emCampo: true },
  { id: 'fechar', teclas: 'Esc', emCampo: true },
  { id: 'ajuda', teclas: '?', emCampo: false },
] as const;
export type IdAtalho = (typeof ATALHOS)[number]['id'];

type Acao = () => void;

export interface TeclaLida {
  readonly key?: string; // ausente no keydown do preenchimento automático
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly code?: string;
}

/** Qual atalho a tecla aciona (independe de haver ação). */
export function atalhoDaTecla(e: TeclaLida): IdAtalho | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = (e.key ?? '').toLowerCase();
  if (ctrl && !e.altKey && k === 'k') return 'paleta';
  if (ctrl && !e.altKey && k === 'enter') return 'concluir';
  if (!ctrl && e.altKey && (k === 'p' || e.code === 'KeyP')) return 'nova-prescricao';
  if (!ctrl && e.altKey && (k === 'e' || e.code === 'KeyE')) return 'nova-evolucao';
  if (ctrl || e.altKey) return null;
  if (e.key === 'F2') return 'salvar-rascunho';
  if (e.key === 'Escape') return 'fechar';
  if (e.key === '/') return 'busca-lista';
  if (e.key === '?') return 'ajuda';
  return null;
}

/** Registro de ações por atalho: a última registrada vence (pilha), e soltar devolve a anterior. */
export class RegistroDeAtalhos {
  private readonly pilhas = new Map<IdAtalho, Acao[]>();
  /** Versão reativa, para o painel "?" se atualizar. */
  readonly versao = shallowRef(0);

  registrar(id: IdAtalho, acao: Acao): () => void {
    const pilha = this.pilhas.get(id) ?? [];
    pilha.push(acao);
    this.pilhas.set(id, pilha);
    this.versao.value++;
    return () => {
      const p = this.pilhas.get(id);
      const i = p?.lastIndexOf(acao) ?? -1;
      if (p && i >= 0) p.splice(i, 1);
      this.versao.value++;
    };
  }

  tem(id: IdAtalho): boolean {
    return (this.pilhas.get(id)?.length ?? 0) > 0;
  }

  /** Atalhos com ação disponível agora (os únicos que o painel "?" mostra). */
  disponiveis(): (typeof ATALHOS)[number][] {
    void this.versao.value;
    return ATALHOS.filter((a) => this.tem(a.id));
  }

  /** Trata a tecla; devolve true se algum atalho agiu (o chamador cancela o padrão do navegador). */
  tratar(e: TeclaLida, alvo: EventTarget | null): boolean {
    const id = atalhoDaTecla(e);
    if (!id) return false;
    const def = ATALHOS.find((a) => a.id === id)!;
    if (!def.emCampo && emCampoDeTexto(alvo)) return false;
    const acao = this.pilhas.get(id)?.at(-1);
    if (!acao) return false;
    acao();
    return true;
  }
}

export function emCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!alvo || typeof (alvo as HTMLElement).tagName !== 'string') return false;
  const el = alvo as HTMLElement;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

export const atalhos = new RegistroDeAtalhos();
