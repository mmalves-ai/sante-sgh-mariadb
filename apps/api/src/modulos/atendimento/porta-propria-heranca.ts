// Herança do atendimento anterior sobre o banco do cliente (regra_heranca_campo): a leitura das marcas em vigor para a
// sessão (a regra do usuário vence a do estabelecimento, que vence a de todo o cliente; sem regra, o padrão do
// domínio) e a gravação da configuração, do estabelecimento ou só do usuário.
// Melhoria: a regra nunca é apagada; desmarcar grava "não herda" no mesmo escopo e "voltar ao padrão do
// estabelecimento" encerra a regra pessoal (encerrada_em), com a trilha de quem mudou o quê. A gravação trava a linha
// do estabelecimento (duas estações não incluem a mesma regra) e a coluna escopo_unico garante a unicidade no banco;
// o controle otimista compara a configuração lida pela tela com a relida dentro da transação.
// A leitura dos valores do atendimento anterior traz também a cobertura principal (carteira, plano, validade) e o
// centro de custo, para a recepção não redigitar.
import { esquemaAlterarHeranca, HERANCAS, type AlterarHerancaEntrada } from '@sgh/contratos';
import { type RegraHeranca, resolverHeranca, versaoHeranca } from '@sgh/dominio-atendimento';
import { definirOperacao, ErroOperacao, type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';

const SQL_REGRAS = `SELECT id, campo, herda, estabelecimento_id, usuario_id, versao, encerrada_em FROM regra_heranca_campo
  WHERE categoria_atendimento_id IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
    AND (usuario_id IS NULL OR usuario_id = ?)
  ORDER BY id`;

const idOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const vale = (x: Linha): boolean => x['encerrada_em'] === null || x['encerrada_em'] === undefined;

function regraDaLinha(x: Linha): RegraHeranca {
  return {
    campo: String(x['campo']),
    herda: Boolean(Number(x['herda'])),
    estabelecimento: idOuNulo(x['estabelecimento_id']),
    usuario: idOuNulo(x['usuario_id']),
  };
}

/** As marcas em vigor (só as regras não encerradas) e, à parte, a do estabelecimento e as pessoais do usuário. */
export function escoposDasLinhas(
  linhas: readonly Linha[],
  estabelecimento: number,
  usuario: number | null,
): {
  marcas: Record<string, boolean>;
  estabelecimento: Record<string, boolean>;
  pessoal: Record<string, boolean>;
} {
  const regras = linhas.filter(vale).map(regraDaLinha);
  const pessoal: Record<string, boolean> = {};
  for (const g of regras)
    if (usuario !== null && g.usuario === usuario && g.estabelecimento === estabelecimento)
      pessoal[g.campo] = g.herda;
  return {
    marcas: resolverHeranca(regras, { estabelecimento, usuario }),
    estabelecimento: resolverHeranca(
      regras.filter((g) => g.usuario === null),
      { estabelecimento, usuario: null },
    ),
    pessoal,
  };
}

/** As marcas da herança para o usuário no estabelecimento, pela chave da regra: em vigor e por escopo. */
export async function lerEscoposHeranca(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  usuario: number | null,
) {
  const linhas = await l.consultar(SQL_REGRAS, [estabelecimento, usuario], { teto: 1_000 });
  return escoposDasLinhas(linhas, estabelecimento, usuario);
}

/** As marcas da herança em vigor para o usuário no estabelecimento, pela chave da regra. */
export async function lerMarcasHeranca(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  usuario: number | null,
): Promise<Record<string, boolean>> {
  return (await lerEscoposHeranca(l, estabelecimento, usuario)).marcas;
}

/**
 * Os valores herdáveis do atendimento anterior além do cabeçalho: cobertura principal e centro de custo. O plano vai
 * pelo código (ou a descrição), que é o que a abertura procura no plano da fonte pagadora.
 */
export async function valoresHerdaveisDoAnterior(
  l: Pick<Leitor, 'uma'>,
  atendimento: number,
): Promise<Record<string, string | number | null>> {
  const x = await l.uma(
    `SELECT a.centro_custo_id, COALESCE(NULLIF(pl.codigo, ''), pl.descricao) AS plano, c.numero_carteira,
            c.validade_carteira
       FROM atendimento a
       LEFT JOIN cobertura_atendimento c ON c.id = (
         SELECT c2.id FROM cobertura_atendimento c2 WHERE c2.atendimento_id = a.id ORDER BY c2.ordem, c2.id LIMIT 1)
       LEFT JOIN plano_fonte_pagadora pl ON pl.id = c.plano_fonte_pagadora_id
      WHERE a.id = ?`,
    [atendimento],
  );
  if (!x) return {};
  const data = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
  const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
  return {
    centroCusto: idOuNulo(x['centro_custo_id']),
    plano: txt(x['plano']),
    matricula: txt(x['numero_carteira']),
    validadeCarteira: data(x['validade_carteira']),
  };
}

/**
 * atendimento.alterarHeranca: grava as marcas mudadas no escopo pedido (estabelecimento ou só o usuário). Só para o
 * usuário, a marca nula encerra a regra pessoal (volta a valer a do estabelecimento), sem apagar a linha.
 */
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
    const marcas = e.marcas as Partial<Record<string, boolean | null>>;
    if (!e.paraMim && Object.values(marcas).some((v) => v === null))
      throw recusa(
        'escopo-invalido',
        'Voltar ao padrão do estabelecimento vale só para a configuração pessoal.',
      );
    // Serializa as gravações do estabelecimento: a regra que ainda não existe não tem linha para o FOR UPDATE travar.
    await tx.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [est], { teto: 1 });
    const linhas = await tx.consultarParaAtualizar(SQL_REGRAS, [est, usuario], { teto: 1_000 });
    const escopos = escoposDasLinhas(linhas, est, usuario);
    if (versaoHeranca(escopos.marcas) !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Configuração alterada por outra pessoa',
        'A configuração da herança mudou desde a leitura. Releia e confira antes de salvar.',
      );
    const escopoUsuario = e.paraMim ? usuario : null;
    const daLinha = (chave: string) =>
      linhas.find(
        (r) =>
          String(r['campo']) === chave &&
          idOuNulo(r['estabelecimento_id']) === est &&
          idOuNulo(r['usuario_id']) === escopoUsuario,
      );
    const mudadas = HERANCAS.filter((h) => {
      const v = marcas[h.campo];
      if (v === undefined) return false;
      if (!e.paraMim) return escopos.estabelecimento[h.chave] !== v;
      const atual = escopos.pessoal[h.chave];
      return v === null ? atual !== undefined : atual !== v;
    });
    if (mudadas.length === 0) throw recusa('nada-a-alterar', 'Nada a alterar.');
    for (const h of mudadas) {
      const v = marcas[h.campo];
      const x = daLinha(h.chave);
      if (v === null) {
        if (x)
          await tx.alterar('regra_heranca_campo', Number(x['id']), Number(x['versao']), {
            encerrada_em: new Date(),
          });
      } else if (x)
        await tx.alterar('regra_heranca_campo', Number(x['id']), Number(x['versao']), {
          herda: v === true,
          encerrada_em: null,
        });
      else
        await tx.incluir('regra_heranca_campo', {
          estabelecimento_id: est,
          categoria_atendimento_id: null,
          usuario_id: escopoUsuario,
          campo: h.chave,
          herda: v === true,
        });
    }
    const depois = await lerMarcasHeranca(tx, est, usuario);
    return { versao: versaoHeranca(depois), campos: mudadas.map((h) => h.chave).join(',') };
  },
  alvo: () => ({ tabela: 'regra_heranca_campo', id: null }),
});
