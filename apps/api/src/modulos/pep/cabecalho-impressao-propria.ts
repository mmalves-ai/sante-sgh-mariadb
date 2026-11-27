// Cadastro do cabeçalho da impressão por tipo de documento (F3, 03-PEP L131), no banco do cliente
// (`cabecalho_impressao_documento`). Contrato de efeito:
//   - regras: as do estabelecimento da sessão e as que valem para todos (estabelecimento nulo), com o tipo de
//     documento, e as opções da tela (tipos de documento clínico ativos);
//   - incluir: validada pela regra do domínio (texto próprio só com a fonte "personalizado", linhas e caracteres,
//     sem marcação nem endereço externo), grava no estabelecimento da sessão ou para todos; a mesma combinação de
//     estabelecimento e tipo não se repete (409);
//   - alterar e ativar/desativar pela versão lida (conflito: 409); nada se apaga;
//   - previa: a regra que vale para um tipo de documento (a mais específica entre as ativas, pelo domínio) e as
//     linhas que o documento imprime, com os dados do estabelecimento ou da mantenedora.
// Regra de negócio no domínio (@sgh/dominio-documento), nenhuma em gatilho. SQL parametrizado.
import {
  FONTES_CABECALHO,
  montarCabecalho,
  type RegraCabecalho,
  resolverCabecalho,
  validarRegraCabecalho,
} from '@sgh/dominio-documento';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_CABECALHO_IMPRESSAO = Symbol('PORTA_CABECALHO_IMPRESSAO');

const CABECALHO = 'cabecalho_impressao_documento';

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const textoLivre = z
  .string()
  .max(2000)
  .nullable()
  .default(null)
  .transform((v) => (v && v.trim() ? v.trim() : null));
const esquemaRegra = z
  .object({
    tipoDocumento: id.nullable().default(null),
    todosEstabelecimentos: z.boolean().default(false),
    fonte: z.enum(FONTES_CABECALHO).default('estabelecimento'),
    cabecalho: textoLivre,
    rodape: textoLivre,
    exibeDadosPaciente: z.boolean().default(true),
    exibeAssinatura: z.boolean().default(true),
  })
  .strict();
const esquemaAlterar = esquemaRegra.omit({ tipoDocumento: true, todosEstabelecimentos: true }).extend({
  versao: id,
});
const esquemaAtivo = z.object({ versao: id, ativo: z.boolean() }).strict();
const esquemaPrevia = z.object({ tipoDocumento: z.coerce.number().int().positive().optional() }).strict();

export interface RegraCabecalhoLida extends RegraCabecalho {
  readonly versao: number;
  readonly tipoDocumentoNome: string | null;
  readonly gerenciavel: boolean;
}

const SQL_REGRAS = `
  SELECT c.id, c.versao, c.estabelecimento_id, c.tipo_documento_clinico_id, t.descricao AS tipo_nome, c.fonte_dados,
         c.cabecalho, c.rodape, c.exibe_dados_paciente, c.exibe_assinatura, c.gerenciavel, c.ativo
    FROM cabecalho_impressao_documento c
    LEFT JOIN tipo_documento_clinico t ON t.id = c.tipo_documento_clinico_id
   WHERE (c.estabelecimento_id = ? OR c.estabelecimento_id IS NULL)`;

function regraLida(r: Linha): RegraCabecalhoLida {
  return {
    id: num(r['id']),
    versao: num(r['versao']),
    estabelecimento: numOuNull(r['estabelecimento_id']),
    tipoDocumento: numOuNull(r['tipo_documento_clinico_id']),
    tipoDocumentoNome: txtOuNull(r['tipo_nome']),
    fonte: String(r['fonte_dados']) as RegraCabecalho['fonte'],
    cabecalho: txtOuNull(r['cabecalho']),
    rodape: txtOuNull(r['rodape']),
    exibeDadosPaciente: bool(r['exibe_dados_paciente']),
    exibeAssinatura: bool(r['exibe_assinatura']),
    gerenciavel: bool(r['gerenciavel']),
    ativo: bool(r['ativo']),
  };
}

const lerRegras = async (l: Leitor, est: number) =>
  (
    await l.consultar<Linha>(
      `${SQL_REGRAS} ORDER BY c.ativo DESC, t.descricao IS NULL DESC, t.descricao, c.id`,
      [est],
    )
  ).map(regraLida);

const repetida = () =>
  new ErroOperacao(
    409,
    'regra-repetida',
    'Regra já existe',
    'Já existe cabeçalho para este tipo de documento neste alcance: altere a regra existente.',
  );
const conflito = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'A regra mudou',
    'Outra pessoa alterou a regra: recarregue e confira.',
  );

/** A regra resolvida para o estabelecimento e o tipo de documento, montada com os dados da instituição. */
async function cabecalhoDoEstabelecimento(l: Leitor, est: number, tipoDocumento: number | null) {
  const regra = resolverCabecalho(await lerRegras(l, est), est, tipoDocumento);
  const e = await l.uma<Linha>(
    `SELECT e.nome_fantasia, e.cnpj, e.codigo_cnes, e.logradouro, e.numero, e.bairro_nome, e.telefone,
            pj.razao_social AS mant_nome, pj.cnpj AS mant_cnpj
       FROM estabelecimento e
       LEFT JOIN mantenedora m ON m.id = e.mantenedora_id
       LEFT JOIN pessoa_juridica pj ON pj.id = m.pessoa_juridica_id
      WHERE e.id = ?`,
    [est],
  );
  if (!e) throw naoEncontrado('Estabelecimento');
  const endereco =
    [txtOuNull(e['logradouro']), txtOuNull(e['numero']), txtOuNull(e['bairro_nome'])]
      .filter(Boolean)
      .join(', ') || null;
  const dados = {
    nome: String(e['nome_fantasia']),
    cnpj: txtOuNull(e['cnpj']),
    cnes: txtOuNull(e['codigo_cnes']),
    endereco,
    telefone: txtOuNull(e['telefone']),
  };
  const mantenedora = e['mant_nome']
    ? {
        nome: String(e['mant_nome']),
        cnpj: txtOuNull(e['mant_cnpj']),
        cnes: null,
        endereco: null,
        telefone: null,
      }
    : null;
  return { regra: regra ? regra.id : null, ...montarCabecalho(regra, dados, mantenedora) };
}

export class PortaCabecalhoImpressaoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [CABECALHO], 'pep.cabecalho');
  }

  /** As regras e as opções da tela. */
  regras(c: ContextoPortaPropria) {
    return this.ler(c, 'regras', async (l, est) => ({
      regras: await lerRegras(l, est.id),
      opcoes: {
        tiposDocumento: (
          await l.consultar<Linha>(
            'SELECT id, descricao AS rotulo FROM tipo_documento_clinico WHERE ativo ORDER BY descricao LIMIT 500',
          )
        ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) })),
      },
    }));
  }

  /** A regra que vale para o tipo de documento e as linhas que o documento imprime. */
  previa(c: ContextoPortaPropria, consulta: unknown) {
    const f = entradaValida(esquemaPrevia, consulta ?? {});
    return this.ler(c, 'previa', (l, est) => cabecalhoDoEstabelecimento(l, est.id, f.tipoDocumento ?? null));
  }

  /**
   * A emissão do PDF (EmissaoService): a regra do estabelecimento (código) e do tipo de documento clínico do pedido,
   * com as linhas do cabeçalho e do rodapé e o que o documento exibe. Leitura só, sem usuário.
   */
  paraEmissao(estabelecimento: string, tipoDocumento: number | null) {
    return this.ler(
      {
        cliente: this.cliente,
        hospital: estabelecimento,
        usuario: null,
        correlacao: 'pep.cabecalho.emissao',
      },
      'emissao',
      (l, est) => cabecalhoDoEstabelecimento(l, est.id, tipoDocumento),
    );
  }

  private conferir(e: { fonte: RegraCabecalho['fonte']; cabecalho: string | null; rodape: string | null }) {
    const falhas = validarRegraCabecalho(e);
    if (falhas.length) throw recusaRegra('Cabeçalho recusado', falhas);
  }

  private async travar(tx: TxOperacao, est: number, regra: number, versao: number) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, gerenciavel FROM cabecalho_impressao_documento
        WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)`,
      [regra, est],
    );
    if (!r) throw naoEncontrado('Regra de cabeçalho');
    if (num(r['versao']) !== versao) throw conflito();
    if (!bool(r['gerenciavel']))
      throw recusaRegra('Regra fixa', [
        {
          campo: 'regra',
          mensagem: 'Esta regra é mantida pela plataforma e não pode ser alterada pelo hospital.',
        },
      ]);
  }

  async incluir(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRegra, entrada);
    this.conferir(e);
    return this.gravar(c, 'pep.cabecalho.incluir', [CABECALHO], async (tx, est) => {
      if (
        e.tipoDocumento !== null &&
        !(await tx.uma('SELECT id FROM tipo_documento_clinico WHERE id = ?', [e.tipoDocumento]))
      )
        throw naoEncontrado('Tipo de documento');
      const alvo = e.todosEstabelecimentos ? null : est.id;
      // A unicidade com nulo não vale no índice (NULL ≠ NULL): a porta confere a combinação.
      if (
        await tx.uma(
          'SELECT id FROM cabecalho_impressao_documento WHERE estabelecimento_id <=> ? AND tipo_documento_clinico_id <=> ?',
          [alvo, e.tipoDocumento],
        )
      )
        throw repetida();
      const regra = await tx.incluir(CABECALHO, {
        estabelecimento_id: alvo,
        tipo_documento_clinico_id: e.tipoDocumento,
        fonte_dados: e.fonte,
        cabecalho: e.cabecalho,
        rodape: e.rodape,
        exibe_dados_paciente: e.exibeDadosPaciente,
        exibe_assinatura: e.exibeAssinatura,
        ativo: true,
      });
      return { tabela: CABECALHO, id: regra };
    });
  }

  async alterar(c: ContextoPortaPropria, regra: number, entrada: unknown) {
    const e = entradaValida(esquemaAlterar, entrada);
    this.conferir(e);
    return this.gravar(c, 'pep.cabecalho.alterar', [CABECALHO], async (tx, est) => {
      await this.travar(tx, est.id, regra, e.versao);
      await tx.alterar(CABECALHO, regra, e.versao, {
        fonte_dados: e.fonte,
        cabecalho: e.cabecalho,
        rodape: e.rodape,
        exibe_dados_paciente: e.exibeDadosPaciente,
        exibe_assinatura: e.exibeAssinatura,
      });
      return { tabela: CABECALHO, id: regra };
    });
  }

  async ativar(c: ContextoPortaPropria, regra: number, entrada: unknown) {
    const e = entradaValida(esquemaAtivo, entrada);
    return this.gravar(c, 'pep.cabecalho.ativar', [CABECALHO], async (tx, est) => {
      await this.travar(tx, est.id, regra, e.versao);
      await tx.alterar(CABECALHO, regra, e.versao, { ativo: e.ativo });
      return { tabela: CABECALHO, id: regra, ativo: e.ativo };
    });
  }
}
