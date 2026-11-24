// Texto padrão da descrição cirúrgica por procedimento e por cirurgião (F3.4, 04-CC linha 91; alimenta a descrição da
// linha 96). Regras puras:
//   - o texto pode ter campos a preencher no formato {{nome_do_campo}}; a lista sai do próprio texto (o cadastro não
//     digita a marcação à parte) e campo mal fechado é recusado na hora;
//   - na descrição, a tela oferece primeiro os textos do cirurgião para o procedimento, depois os dele para qualquer
//     procedimento, depois os do serviço para o procedimento e, por fim, os do serviço para qualquer procedimento;
//   - preencher troca os campos pelos valores e devolve os que faltam (a descrição não sai com campo em aberto).
// O texto nunca é apagado: sai de uso (ativo = falso) e a versão anterior fica na trilha.

export interface TextoPadraoCirurgia {
  readonly id: number;
  readonly titulo: string;
  readonly procedimento: number | null;
  readonly cirurgiao: number | null;
  readonly textoDescricao: string;
  readonly textoRisco: string | null;
  readonly textoIntercorrencia: string | null;
  readonly ativo: boolean;
}

export interface EntradaTextoPadrao {
  readonly titulo: string;
  readonly textoDescricao: string;
  readonly textoRisco?: string | null;
  readonly textoIntercorrencia?: string | null;
}

export interface ProblemaTexto {
  readonly campo: string;
  readonly mensagem: string;
}

const CAMPO = /\{\{\s*([a-z][a-z0-9_]{0,59})\s*\}\}/g;
const LIMITE_TEXTO = 20_000;

/** Os campos a preencher do texto, na ordem em que aparecem, sem repetir. */
export function camposDoTexto(...textos: readonly (string | null | undefined)[]): string[] {
  const vistos: string[] = [];
  for (const t of textos)
    for (const m of (t ?? '').matchAll(CAMPO)) if (!vistos.includes(m[1]!)) vistos.push(m[1]!);
  return vistos;
}

function marcacaoQuebrada(t: string): boolean {
  const semCampos = t.replace(CAMPO, '');
  return semCampos.includes('{{') || semCampos.includes('}}');
}

/** Confere o texto padrão antes de gravar. */
export function validarTextoPadrao(e: EntradaTextoPadrao): ProblemaTexto[] {
  const p: ProblemaTexto[] = [];
  const titulo = e.titulo.trim();
  if (titulo.length < 3 || titulo.length > 150)
    p.push({ campo: 'titulo', mensagem: 'O título tem de 3 a 150 caracteres.' });
  const textos: [string, string | null | undefined][] = [
    ['textoDescricao', e.textoDescricao],
    ['textoRisco', e.textoRisco],
    ['textoIntercorrencia', e.textoIntercorrencia],
  ];
  if (!e.textoDescricao.trim())
    p.push({ campo: 'textoDescricao', mensagem: 'O modelo da descrição é obrigatório.' });
  for (const [campo, t] of textos) {
    if (!t) continue;
    if (t.length > LIMITE_TEXTO) p.push({ campo, mensagem: `O texto passa de ${LIMITE_TEXTO} caracteres.` });
    if (marcacaoQuebrada(t))
      p.push({
        campo,
        mensagem: 'Campo a preencher mal escrito: use {{nome_do_campo}} (minúsculas, números e sublinhado).',
      });
  }
  return p;
}

/** Os textos que a descrição oferece ao cirurgião para o procedimento, na ordem de preferência. */
export function textosParaDescricao<T extends TextoPadraoCirurgia>(
  textos: readonly T[],
  alvo: { readonly procedimento: number | null; readonly cirurgiao: number | null },
): T[] {
  const nota = (t: T) => (t.cirurgiao !== null ? 2 : 0) + (t.procedimento !== null ? 1 : 0);
  return textos
    .filter(
      (t) =>
        t.ativo &&
        (t.procedimento === null || t.procedimento === alvo.procedimento) &&
        (t.cirurgiao === null || t.cirurgiao === alvo.cirurgiao),
    )
    .sort((a, b) => nota(b) - nota(a) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

/** Troca os campos pelos valores; os que ficaram sem valor saem em `faltando` e ficam marcados no texto. */
export function preencherTexto(
  texto: string,
  valores: Readonly<Record<string, string>>,
): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const saida = texto.replace(CAMPO, (inteiro, nome: string) => {
    const v = valores[nome]?.trim();
    if (v) return v;
    if (!faltando.includes(nome)) faltando.push(nome);
    return inteiro;
  });
  return { texto: saida, faltando };
}
