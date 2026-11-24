// Herança do atendimento anterior sobre o banco do cliente (regra_heranca_campo): a leitura das marcas em vigor para a
// sessão (a regra do usuário vence a do estabelecimento, que vence a de todo o cliente; sem regra, o padrão do
// domínio) e a gravação da configuração, do estabelecimento ou só do usuário (os valores padrão dele).
// Melhoria: a regra nunca é apagada; desmarcar grava "não herda" no mesmo escopo (a trilha guarda quem mudou o quê),
// e o controle otimista compara a configuração lida pela tela com a relida dentro da transação.
// A leitura dos valores do atendimento anterior traz também a cobertura principal (carteira, plano, validade, guia,
// empresa) e o centro de custo, para a recepção não redigitar.
import { esquemaAlterarHeranca, HERANCAS, type AlterarHerancaEntrada } from '@sgh/contratos';
import { type RegraHeranca, resolverHeranca, versaoHeranca } from '@sgh/dominio-atendimento';
import { definirOperacao, ErroOperacao, type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';

const SQL_REGRAS = `SELECT id, campo, herda, estabelecimento_id, usuario_id, versao FROM regra_heranca_campo
  WHERE categoria_atendimento_id IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
    AND (usuario_id IS NULL OR usuario_id = ?)`;

const idOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function regraDaLinha(x: Linha): RegraHeranca {
  return {
    campo: String(x['campo']),
    herda: Boolean(Number(x['herda'])),
    estabelecimento: idOuNulo(x['estabelecimento_id']),
    usuario: idOuNulo(x['usuario_id']),
  };
}

/** As marcas da herança em vigor para o usuário no estabelecimento, pela chave da regra. */
export async function lerMarcasHeranca(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  usuario: number | null,
): Promise<Record<string, boolean>> {
  const linhas = await l.consultar(SQL_REGRAS, [estabelecimento, usuario], { teto: 1_000 });
  return resolverHeranca(linhas.map(regraDaLinha), { estabelecimento, usuario });
}

/** Os valores herdáveis do atendimento anterior além do cabeçalho: cobertura principal e centro de custo. */
export async function valoresHerdaveisDoAnterior(
  l: Pick<Leitor, 'uma'>,
  atendimento: number,
): Promise<Record<string, string | number | null>> {
  const x = await l.uma(
    `SELECT a.centro_custo_id, c.plano_fonte_pagadora_id, c.numero_carteira, c.validade_carteira, c.numero_guia,
            c.empresa_segurado
       FROM atendimento a
       LEFT JOIN cobertura_atendimento c ON c.id = (
         SELECT c2.id FROM cobertura_atendimento c2 WHERE c2.atendimento_id = a.id ORDER BY c2.ordem, c2.id LIMIT 1)
      WHERE a.id = ?`,
    [atendimento],
  );
  if (!x) return {};
  const data = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
  const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
  return {
    centroCusto: idOuNulo(x['centro_custo_id']),
    plano: idOuNulo(x['plano_fonte_pagadora_id']),
    matricula: txt(x['numero_carteira']),
    validadeCarteira: data(x['validade_carteira']),
    guia: txt(x['numero_guia']),
    empresa: txt(x['empresa_segurado']),
  };
}

/** atendimento.alterarHeranca: grava as marcas mudadas no escopo pedido (estabelecimento ou só o usuário). */
export const OPERACAO_ALTERAR_HERANCA = definirOperacao({
  nome: 'atendimento.alterar-heranca',
  tabelas: ['regra_heranca_campo'],
  entrada: esquemaAlterarHeranca,
  acao: 'alteracao',
  async gravar(tx: TxOperacao, e: AlterarHerancaEntrada) {
    const est = tx.contexto.estabelecimento;
    if (est === null) throw recusa('estabelecimento-obrigatorio', 'Escolha o estabelecimento.');
    const usuario = tx.contexto.usuario;
    if (e.paraMim && usuario === null)
      throw recusa('usuario-obrigatorio', 'A configuração pessoal exige o usuário da sessão.');
    const linhas = await tx.consultarParaAtualizar(SQL_REGRAS, [est, usuario], { teto: 1_000 });
    const atuais = resolverHeranca(linhas.map(regraDaLinha), { estabelecimento: est, usuario });
    if (versaoHeranca(atuais) !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Configuração alterada por outra pessoa',
        'A configuração da herança mudou desde a leitura. Releia e confira antes de salvar.',
      );
    const escopoUsuario = e.paraMim ? usuario : null;
    const marcas = e.marcas as Partial<Record<string, boolean>>;
    const mudadas = HERANCAS.filter((h) => {
      const v = marcas[h.campo];
      if (v === undefined) return false;
      // No escopo do estabelecimento, grava também quando o usuário tem regra própria diferente: a do escopo muda.
      const doEscopo = linhas.find(
        (x) =>
          String(x['campo']) === h.chave &&
          idOuNulo(x['estabelecimento_id']) === est &&
          idOuNulo(x['usuario_id']) === escopoUsuario,
      );
      return doEscopo ? Boolean(Number(doEscopo['herda'])) !== v : atuais[h.chave] !== v;
    });
    if (mudadas.length === 0) throw recusa('nada-a-alterar', 'Nada a alterar.');
    for (const h of mudadas) {
      const herda = marcas[h.campo] === true;
      const x = linhas.find(
        (r) =>
          String(r['campo']) === h.chave &&
          idOuNulo(r['estabelecimento_id']) === est &&
          idOuNulo(r['usuario_id']) === escopoUsuario,
      );
      if (x) await tx.alterar('regra_heranca_campo', Number(x['id']), Number(x['versao']), { herda });
      else
        await tx.incluir('regra_heranca_campo', {
          estabelecimento_id: est,
          categoria_atendimento_id: null,
          usuario_id: escopoUsuario,
          campo: h.chave,
          herda,
        });
    }
    const depois = await lerMarcasHeranca(tx, est, usuario);
    return { versao: versaoHeranca(depois), campos: mudadas.map((h) => h.chave).join(',') };
  },
  alvo: () => ({ tabela: 'regra_heranca_campo', id: null }),
});
