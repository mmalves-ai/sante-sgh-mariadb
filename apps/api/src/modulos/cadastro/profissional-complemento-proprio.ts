// Complemento do cadastro do profissional no banco próprio (F3.1, 02-CAD linha 16): dados fiscais do repasse
// (`profissional_dado_fiscal`, com vigência por estabelecimento e um só por dia), contas para o pagamento
// (`conta_bancaria_profissional`, conta ou chave de pagamento instantâneo, favorecido conferido, uma principal), registros
// de qualificação de especialista (`profissional_rqe`) e assinaturas (`profissional_assinatura`, imagem ou certificado,
// uma vigente por tipo). A regra é a do domínio (@sgh/dominio-cadastro, profissional/financeiro.ts); aqui só leitura,
// gravação e trilha, pelo executor (trilha e idempotência na mesma transação). Nada se apaga: o dado fiscal e a
// assinatura encerram a vigência; a conta e o RQE são inativados.
import { randomUUID } from 'node:crypto';
import {
  errosAssinatura,
  errosContaBancaria,
  errosDadoFiscal,
  errosRqe,
  favorecidoTerceiro,
  INCIDENCIAS_IMPOSTO,
  REGIMES_TRIBUTARIOS,
  sobreposicaoFiscal,
  TIPOS_ASSINATURA,
  TIPOS_CHAVE_PIX,
  TIPOS_RECEBEDOR,
  vespera,
} from '@sgh/dominio-cadastro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const COMPLEMENTO_PROFISSIONAL = Symbol('COMPLEMENTO_PROFISSIONAL');

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const recusaCampos = (codigo: string, msg: string, campos: string[]) => recusa(codigo, msg, { campos });

async function hojeDe(x: Leitor | TxOperacao): Promise<string> {
  const r = await x.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d', []);
  return data(r?.d) ?? new Date().toISOString().slice(0, 10);
}

async function conferirProfissional(tx: TxOperacao, id: number): Promise<{ cpf: string | null }> {
  const p = await tx.uma(
    `SELECT pf.cpf FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE p.id = ? AND p.excluido_em IS NULL`,
    [id],
  );
  if (!p)
    throw new ErroOperacao(404, 'profissional-inexistente', 'Não encontrado', 'Profissional não encontrado.');
  return { cpf: texto(p['cpf']) };
}

const proximaSequencia = async (tx: TxOperacao, tabela: string, profissional: number): Promise<number> => {
  const r = await tx.uma(
    `SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM ${tabela} WHERE profissional_id = ?`,
    [profissional],
  );
  return Number(r?.['s'] ?? 1);
};

const MENSAGENS: Record<string, string> = {
  'vigencia-invertida': 'O fim da vigência é anterior ao início.',
  'recebedor-sem-empresa': 'Recebedor pessoa jurídica exige a empresa.',
  'empresa-sem-recebedor-pj': 'A empresa só se informa quando o recebedor é pessoa jurídica.',
  'pis-invalido': 'PIS/PASEP inválido (dígito verificador).',
  'aliquota-iss-fora': 'A alíquota do ISS fica entre 0 e 100%.',
  'percentual-inss-fora': 'O percentual do INSS fica entre 0 e 100%.',
  'retencao-iss-sem-aliquota': 'Reter ISS exige a alíquota.',
  'retencao-inss-sem-percentual': 'Reter INSS exige o percentual.',
  'dependentes-em-pj': 'Pessoa jurídica não tem dependentes de IRRF.',
  'mei-sem-empresa': 'MEI recebe como pessoa jurídica.',
  'dependentes-fora': 'Dependentes de IRRF entre 0 e 99.',
  'sem-meio-pagamento': 'Informe a conta (banco, agência e número) ou a chave de pagamento instantâneo.',
  'conta-incompleta': 'A conta precisa de banco, agência e número.',
  'agencia-invalida': 'A agência tem só dígitos.',
  'conta-invalida': 'O número da conta tem só dígitos.',
  'chave-sem-tipo': 'A chave de pagamento instantâneo exige o tipo, e o tipo exige a chave.',
  'chave-invalida': 'A chave não está na forma do tipo escolhido.',
  'favorecido-sem-nome': 'Informe o nome do favorecido.',
  'favorecido-documento-invalido': 'CPF ou CNPJ do favorecido inválido.',
  'chave-de-outro-favorecido': 'A chave de CPF ou CNPJ tem de ser o documento do próprio favorecido.',
  'rqe-invalido': 'O RQE tem só dígitos (até 10).',
  'rqe-data-futura': 'A data do registro não pode ser futura.',
  'imagem-sem-arquivo': 'A assinatura em imagem exige o arquivo enviado.',
  'imagem-com-certificado': 'A assinatura em imagem não leva dados de certificado.',
  'serie-invalida': 'Número de série do certificado inválido (hexadecimal).',
  'impressao-digital-invalida':
    'A impressão digital do certificado é o SHA-256 (64 caracteres hexadecimais).',
  'certificado-sem-titular': 'Informe o titular do certificado.',
  'certificado-com-imagem': 'O certificado não leva arquivo de imagem.',
};
const CAMPO: Record<string, string> = {
  'vigencia-invertida': 'vigenciaFim',
  'recebedor-sem-empresa': 'pessoaJuridica',
  'empresa-sem-recebedor-pj': 'pessoaJuridica',
  'pis-invalido': 'pisPasep',
  'aliquota-iss-fora': 'aliquotaIss',
  'percentual-inss-fora': 'percentualInss',
  'retencao-iss-sem-aliquota': 'aliquotaIss',
  'retencao-inss-sem-percentual': 'percentualInss',
  'dependentes-em-pj': 'dependentesIrrf',
  'mei-sem-empresa': 'regime',
  'dependentes-fora': 'dependentesIrrf',
  'sem-meio-pagamento': 'chavePix',
  'conta-incompleta': 'numeroConta',
  'agencia-invalida': 'agencia',
  'conta-invalida': 'numeroConta',
  'chave-sem-tipo': 'tipoChavePix',
  'chave-invalida': 'chavePix',
  'favorecido-sem-nome': 'favorecidoNome',
  'favorecido-documento-invalido': 'favorecidoDocumento',
  'chave-de-outro-favorecido': 'chavePix',
  'rqe-invalido': 'numero',
  'rqe-data-futura': 'dataRegistro',
  'imagem-sem-arquivo': 'arquivo',
  'imagem-com-certificado': 'numeroSerie',
  'serie-invalida': 'numeroSerie',
  'impressao-digital-invalida': 'impressaoDigital',
  'certificado-sem-titular': 'titular',
  'certificado-com-imagem': 'arquivo',
};
/** Recusa com todos os erros do domínio de uma vez (a tela marca cada campo). */
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => CAMPO[e] ?? e))],
  });
}

// ── Dado fiscal ──

const esquemaFiscal = z
  .object({
    profissional: z.number().int().positive(),
    estabelecimento: z.number().int().positive().nullable(),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable(),
    tipoRecebedor: z.enum(TIPOS_RECEBEDOR),
    pessoaJuridica: z.number().int().positive().nullable(),
    regime: z.enum(REGIMES_TRIBUTARIOS).nullable(),
    inscricaoMunicipal: z.string().trim().max(20).nullable(),
    inscricaoInss: z.string().trim().max(15).nullable(),
    pisPasep: z.string().nullable(),
    categoriaSefip: z.number().int().min(0).max(999).nullable(),
    aliquotaIss: z.number().nullable(),
    percentualInss: z.number().nullable(),
    retemIss: z.boolean(),
    retemInss: z.boolean(),
    retemIrrf: z.boolean(),
    retemPisCofinsCsll: z.boolean(),
    dependentesIrrf: z.number().int(),
    incidencia: z.enum(INCIDENCIAS_IMPOSTO).nullable(),
  })
  .strict();
export type EntradaDadoFiscal = z.infer<typeof esquemaFiscal>;

const operacaoGravarFiscal = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.profissional.gravar-dado-fiscal',
    tabelas: ['profissional_dado_fiscal'],
    entrada: esquemaFiscal,
    acao: 'inclusao',
    async gravar(tx, e) {
      await conferirProfissional(tx, e.profissional);
      recusarErros(errosDadoFiscal(e));
      if (
        e.pessoaJuridica !== null &&
        !(await tx.uma('SELECT id FROM pessoa_juridica WHERE id = ? AND excluido_em IS NULL', [
          e.pessoaJuridica,
        ]))
      )
        throw recusaCampos('empresa-inexistente', 'A empresa não existe no cadastro.', ['pessoaJuridica']);
      if (
        e.estabelecimento !== null &&
        !(await tx.uma('SELECT id FROM estabelecimento WHERE id = ? AND excluido_em IS NULL', [
          e.estabelecimento,
        ]))
      )
        throw recusaCampos('estabelecimento-inexistente', 'O estabelecimento não existe.', [
          'estabelecimento',
        ]);
      const vigentes = await tx.consultar(
        `SELECT id, estabelecimento_id, vigencia_inicio, vigencia_fim, versao FROM profissional_dado_fiscal
          WHERE profissional_id = ? AND excluido_em IS NULL FOR UPDATE`,
        [e.profissional],
      );
      const versoes = new Map(vigentes.map((v) => [Number(v['id']), Number(v['versao'])]));
      const s = sobreposicaoFiscal(
        vigentes.map((v) => ({
          id: Number(v['id']),
          estabelecimento: num(v['estabelecimento_id']),
          inicio: data(v['vigencia_inicio'])!,
          fim: data(v['vigencia_fim']),
        })),
        { estabelecimento: e.estabelecimento, inicio: e.vigenciaInicio, fim: e.vigenciaFim },
      );
      if (s.conflitos.length)
        throw recusaCampos(
          'vigencia-sobreposta',
          'Já há dado fiscal neste período para o mesmo escopo: encerre o anterior ou ajuste a vigência.',
          ['vigenciaInicio'],
        );
      for (const x of s.encerrar)
        await tx.alterar('profissional_dado_fiscal', x.id, versoes.get(x.id)!, { vigencia_fim: x.fim });
      const id = await tx.incluir('profissional_dado_fiscal', {
        profissional_id: e.profissional,
        sequencia: await proximaSequencia(tx, 'profissional_dado_fiscal', e.profissional),
        estabelecimento_id: e.estabelecimento,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        tipo_recebedor: e.tipoRecebedor,
        pessoa_juridica_id: e.pessoaJuridica,
        regime_tributario: e.regime,
        inscricao_municipal: e.inscricaoMunicipal || null,
        inscricao_inss: e.inscricaoInss || null,
        pis_pasep: e.pisPasep,
        categoria_sefip: e.categoriaSefip,
        aliquota_iss: e.aliquotaIss,
        percentual_inss: e.percentualInss,
        retem_iss: e.retemIss,
        retem_inss: e.retemInss,
        retem_irrf: e.retemIrrf,
        retem_pis_cofins_csll: e.retemPisCofinsCsll,
        dependentes_irrf: e.dependentesIrrf,
        incidencia_imposto: e.incidencia,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_dado_fiscal', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Encerrar (dado fiscal e assinatura) e inativar (conta e RQE) ──

const esquemaEncerrar = z
  .object({
    profissional: z.number().int().positive(),
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    fim: dia.nullable(),
  })
  .strict();

type TabelaComplemento =
  'profissional_dado_fiscal' | 'profissional_assinatura' | 'conta_bancaria_profissional' | 'profissional_rqe';

const operacaoEncerrar = (tabela: TabelaComplemento, trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: `cadastro.profissional.encerrar-${tabela}`,
    tabelas: [tabela],
    entrada: esquemaEncerrar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const temVigencia = tabela === 'profissional_dado_fiscal' || tabela === 'profissional_assinatura';
      const temAtivo = tabela !== 'profissional_dado_fiscal';
      const x = await tx.uma(
        `SELECT id, versao${temVigencia ? ', vigencia_inicio, vigencia_fim' : ''}${temAtivo ? ', ativo' : ''}
           ${tabela === 'conta_bancaria_profissional' ? ', principal' : ''}
           FROM ${tabela} WHERE id = ? AND profissional_id = ? AND excluido_em IS NULL`,
        [e.id, e.profissional],
      );
      if (!x)
        throw new ErroOperacao(404, 'registro-inexistente', 'Não encontrado', 'Registro não encontrado.');
      const valores: Record<string, unknown> = {};
      if (temVigencia) {
        if (x['vigencia_fim'] !== null)
          throw recusaCampos('ja-encerrado', 'A vigência já está encerrada.', ['fim']);
        const fim = e.fim ?? (await hojeDe(tx));
        const inicio = data(x['vigencia_inicio'])!;
        if (fim < inicio)
          throw recusaCampos('vigencia-invertida', 'O fim da vigência é anterior ao início.', ['fim']);
        valores['vigencia_fim'] = fim;
      }
      if (temAtivo) {
        if (!bool(x['ativo'])) throw recusaCampos('ja-inativo', 'O registro já está inativo.', ['id']);
        valores['ativo'] = false;
      }
      if (tabela === 'conta_bancaria_profissional') valores['principal'] = false;
      await tx.alterar(tabela, e.id, Number(x['versao']), valores);
      // A conta principal que sai passa a principal para a ativa mais recente (o repasse nunca fica sem destino).
      if (tabela === 'conta_bancaria_profissional' && bool(x['principal'])) {
        const s = await tx.uma(
          `SELECT id, versao FROM conta_bancaria_profissional WHERE profissional_id = ? AND ativo
             AND excluido_em IS NULL AND id <> ? ORDER BY sequencia DESC LIMIT 1`,
          [e.profissional, e.id],
        );
        if (s) await tx.alterar(tabela, Number(s['id']), Number(s['versao']), { principal: true });
      }
      return { id: e.id };
    },
    alvo: (e) => ({ tabela, id: e.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Conta bancária ──

const esquemaConta = z
  .object({
    profissional: z.number().int().positive(),
    banco: z.number().int().positive().nullable(),
    tipoConta: z.number().int().positive().nullable(),
    agencia: z.string().nullable(),
    agenciaDigito: z.string().max(2).nullable(),
    numeroConta: z.string().nullable(),
    contaDigito: z.string().max(2).nullable(),
    tipoChavePix: z.enum(TIPOS_CHAVE_PIX).nullable(),
    chavePix: z.string().max(77).nullable(),
    favorecidoNome: z.string().trim().max(150),
    favorecidoTipo: z.enum(['fisica', 'juridica']),
    favorecidoDocumento: z.string(),
    principal: z.boolean(),
    /** O favorecido não é o profissional nem a empresa dele: só com a confirmação explícita de quem grava. */
    confirmaTerceiro: z.boolean(),
  })
  .strict();
export type EntradaConta = z.infer<typeof esquemaConta>;

const operacaoIncluirConta = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.profissional.incluir-conta',
    tabelas: ['conta_bancaria_profissional'],
    entrada: esquemaConta,
    acao: 'inclusao',
    async gravar(tx, e) {
      const { cpf } = await conferirProfissional(tx, e.profissional);
      recusarErros(errosContaBancaria(e));
      if (e.banco !== null && !(await tx.uma('SELECT id FROM banco WHERE id = ?', [e.banco])))
        throw recusaCampos('banco-inexistente', 'O banco não existe no catálogo.', ['banco']);
      if (
        e.tipoConta !== null &&
        !(await tx.uma('SELECT id FROM tipo_conta_bancaria WHERE id = ? AND ativo', [e.tipoConta]))
      )
        throw recusaCampos('tipo-conta-inexistente', 'O tipo de conta não existe.', ['tipoConta']);
      const cnpjs = (
        await tx.consultar(
          `SELECT DISTINCT pj.cnpj FROM profissional_dado_fiscal f JOIN pessoa_juridica pj ON pj.id = f.pessoa_juridica_id
            WHERE f.profissional_id = ? AND f.excluido_em IS NULL AND pj.cnpj IS NOT NULL`,
          [e.profissional],
        )
      ).map((x) => String(x['cnpj']));
      if (favorecidoTerceiro(e.favorecidoDocumento, cpf, cnpjs) && !e.confirmaTerceiro)
        throw recusaCampos(
          'favorecido-terceiro',
          'O favorecido não é o profissional nem a empresa dele no dado fiscal. Confirme o pagamento a terceiro.',
          ['favorecidoDocumento'],
        );
      const ativas = await tx.consultar(
        `SELECT id, versao, principal FROM conta_bancaria_profissional
          WHERE profissional_id = ? AND ativo AND excluido_em IS NULL FOR UPDATE`,
        [e.profissional],
      );
      // A primeira conta é a principal; a nova principal tira a marca da anterior (uma só).
      const principal = e.principal || ativas.length === 0;
      if (principal)
        for (const a of ativas.filter((a) => bool(a['principal'])))
          await tx.alterar('conta_bancaria_profissional', Number(a['id']), Number(a['versao']), {
            principal: false,
          });
      const id = await tx.incluir('conta_bancaria_profissional', {
        profissional_id: e.profissional,
        sequencia: await proximaSequencia(tx, 'conta_bancaria_profissional', e.profissional),
        banco_id: e.banco,
        tipo_conta_bancaria_id: e.tipoConta,
        agencia: e.agencia || null,
        agencia_digito: e.agenciaDigito || null,
        numero_conta: e.numeroConta || null,
        conta_digito: e.contaDigito || null,
        tipo_chave_pix: e.tipoChavePix,
        chave_pix: e.chavePix,
        favorecido_nome: e.favorecidoNome,
        favorecido_tipo: e.favorecidoTipo,
        favorecido_documento: e.favorecidoDocumento,
        principal,
        ativo: true,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'conta_bancaria_profissional', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── RQE ──

const esquemaRqe = z
  .object({
    profissional: z.number().int().positive(),
    numero: z.string(),
    uf: z.string().regex(/^[A-Z]{2}$/),
    especialidade: z.number().int().positive(),
    dataRegistro: dia.nullable(),
  })
  .strict();
export type EntradaRqe = z.infer<typeof esquemaRqe>;

const operacaoIncluirRqe = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.profissional.incluir-rqe',
    tabelas: ['profissional_rqe'],
    entrada: esquemaRqe,
    acao: 'inclusao',
    async gravar(tx, e) {
      await conferirProfissional(tx, e.profissional);
      recusarErros(errosRqe(e, await hojeDe(tx)));
      const uf = await tx.uma('SELECT id FROM unidade_federativa WHERE sigla = ?', [e.uf]);
      if (!uf) throw recusaCampos('uf-inexistente', 'UF não encontrada.', ['uf']);
      const esp = await tx.uma(
        'SELECT id, conselho_classe_id FROM especialidade_medica WHERE id = ? AND ativo',
        [e.especialidade],
      );
      if (!esp)
        throw recusaCampos('especialidade-inexistente', 'Especialidade não encontrada.', ['especialidade']);
      // O RQE é dado pelo conselho da UF: exige o registro do profissional nesse conselho e UF (ativo ou provisório).
      const insc = await tx.uma(
        `SELECT id, conselho_classe_id FROM inscricao_conselho WHERE profissional_id = ? AND unidade_federativa_id = ?
            AND situacao IN ('ativa', 'provisoria') AND excluido_em IS NULL
            AND (? IS NULL OR conselho_classe_id = ?) ORDER BY principal DESC, sequencia LIMIT 1`,
        [e.profissional, uf['id'], esp['conselho_classe_id'], esp['conselho_classe_id']],
      );
      if (!insc)
        throw recusaCampos(
          'rqe-sem-registro-na-uf',
          'O profissional não tem registro ativo no conselho desta UF: inclua o registro antes do RQE.',
          ['uf'],
        );
      const ja = await tx.uma(
        `SELECT id, versao, ativo FROM profissional_rqe WHERE profissional_id = ? AND especialidade_medica_id = ?
            AND unidade_federativa_id = ? AND excluido_em IS NULL`,
        [e.profissional, e.especialidade, uf['id']],
      );
      const valores = {
        numero_rqe: e.numero,
        conselho_classe_id: num(insc['conselho_classe_id']),
        inscricao_conselho_id: Number(insc['id']),
        data_registro: e.dataRegistro,
        ativo: true,
      };
      if (ja) {
        if (bool(ja['ativo']))
          throw recusaCampos('rqe-repetido', 'O profissional já tem RQE ativo nesta especialidade e UF.', [
            'especialidade',
          ]);
        // O RQE inativado volta na mesma linha (a trilha guarda a inativação e a volta).
        await tx.alterar('profissional_rqe', Number(ja['id']), Number(ja['versao']), valores);
        return { id: Number(ja['id']) };
      }
      const outro = await tx.uma(
        `SELECT id FROM profissional_rqe WHERE unidade_federativa_id = ? AND numero_rqe = ? AND ativo
            AND excluido_em IS NULL AND profissional_id <> ?`,
        [uf['id'], e.numero, e.profissional],
      );
      if (outro)
        throw recusaCampos('rqe-de-outro', 'Este RQE nesta UF já está no cadastro de outro profissional.', [
          'numero',
        ]);
      const id = await tx.incluir('profissional_rqe', {
        profissional_id: e.profissional,
        sequencia: await proximaSequencia(tx, 'profissional_rqe', e.profissional),
        unidade_federativa_id: Number(uf['id']),
        especialidade_medica_id: e.especialidade,
        ...valores,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_rqe', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Assinatura ──

const esquemaAssinatura = z
  .object({
    profissional: z.number().int().positive(),
    tipo: z.enum(TIPOS_ASSINATURA),
    arquivo: z.number().int().positive().nullable(),
    titular: z.string().trim().max(150).nullable(),
    numeroSerie: z.string().trim().max(64).nullable(),
    emissor: z.string().trim().max(150).nullable(),
    impressaoDigital: z.string().trim().nullable(),
    usoTiss: z.boolean(),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable(),
  })
  .strict();
export type EntradaAssinatura = z.infer<typeof esquemaAssinatura>;

const operacaoIncluirAssinatura = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.profissional.incluir-assinatura',
    tabelas: ['profissional_assinatura'],
    entrada: esquemaAssinatura,
    acao: 'inclusao',
    async gravar(tx, e) {
      await conferirProfissional(tx, e.profissional);
      recusarErros(errosAssinatura(e));
      if (e.arquivo !== null) {
        const a = await tx.uma('SELECT tipo_mime FROM arquivo WHERE id = ?', [e.arquivo]);
        if (!a || !/^image\/(png|jpeg)$/.test(String(a['tipo_mime'])))
          throw recusaCampos('arquivo-nao-imagem', 'O arquivo da assinatura tem de ser imagem PNG ou JPEG.', [
            'arquivo',
          ]);
      }
      if (e.tipo === 'certificado_digital') {
        const outro = await tx.uma(
          `SELECT id FROM profissional_assinatura WHERE certificado_numero_serie = ? AND ativo AND excluido_em IS NULL
              AND profissional_id <> ?`,
          [e.numeroSerie, e.profissional],
        );
        if (outro)
          throw recusaCampos(
            'certificado-de-outro',
            'Este certificado já está no cadastro de outro profissional.',
            ['numeroSerie'],
          );
      }
      // Uma assinatura vigente por tipo: a anterior aberta encerra na véspera da nova; a que começaria depois sai de uso.
      const abertas = await tx.consultar(
        `SELECT id, versao, vigencia_inicio FROM profissional_assinatura WHERE profissional_id = ? AND tipo = ?
            AND ativo AND vigencia_fim IS NULL AND excluido_em IS NULL FOR UPDATE`,
        [e.profissional, e.tipo],
      );
      for (const a of abertas) {
        const inicio = data(a['vigencia_inicio'])!;
        await tx.alterar(
          'profissional_assinatura',
          Number(a['id']),
          Number(a['versao']),
          inicio < e.vigenciaInicio
            ? { vigencia_fim: vespera(e.vigenciaInicio) }
            : { vigencia_fim: inicio, ativo: false },
        );
      }
      const id = await tx.incluir('profissional_assinatura', {
        profissional_id: e.profissional,
        tipo: e.tipo,
        arquivo_id: e.arquivo,
        certificado_titular: e.titular || null,
        certificado_numero_serie: e.numeroSerie ? e.numeroSerie.toUpperCase() : null,
        certificado_emissor: e.emissor || null,
        certificado_impressao_digital: e.impressaoDigital ? e.impressaoDigital.toLowerCase() : null,
        uso_tiss: e.usoTiss,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_assinatura', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

// ── Leituras ──

export interface ComplementoProfissional {
  rqes: {
    id: number;
    versao: number;
    numero: string;
    uf: string;
    especialidade: number;
    especialidadeDescricao: string;
    conselho: string | null;
    dataRegistro: string | null;
    ativo: boolean;
  }[];
  assinaturas: {
    id: number;
    versao: number;
    tipo: string;
    arquivo: number | null;
    titular: string | null;
    numeroSerie: string | null;
    emissor: string | null;
    usoTiss: boolean;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    ativo: boolean;
    vigente: boolean;
  }[];
}

export interface FinanceiroProfissional {
  fiscais: {
    id: number;
    versao: number;
    estabelecimento: number | null;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    tipoRecebedor: string;
    pessoaJuridica: number | null;
    empresa: string | null;
    regime: string | null;
    inscricaoMunicipal: string | null;
    pisPasep: string | null;
    aliquotaIss: number | null;
    percentualInss: number | null;
    retemIss: boolean;
    retemInss: boolean;
    retemIrrf: boolean;
    retemPisCofinsCsll: boolean;
    dependentesIrrf: number;
    incidencia: string | null;
    vigente: boolean;
  }[];
  contas: {
    id: number;
    versao: number;
    banco: number | null;
    bancoDescricao: string | null;
    agencia: string | null;
    numeroConta: string | null;
    tipoChavePix: string | null;
    chavePix: string | null;
    favorecidoNome: string;
    favorecidoTipo: string;
    favorecidoDocumento: string;
    principal: boolean;
    ativo: boolean;
  }[];
}

export class ProfissionalComplementoProprio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: trilha.estabelecimento ?? est,
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as { id: unknown }).id);
  }

  gravarDadoFiscal(c: ContextoPorta, e: EntradaDadoFiscal, t: RegistroTrilhaTela) {
    return this.executar(c, operacaoGravarFiscal(t), e, t);
  }
  incluirConta(c: ContextoPorta, e: EntradaConta, t: RegistroTrilhaTela) {
    return this.executar(c, operacaoIncluirConta(t), e, t);
  }
  incluirRqe(c: ContextoPorta, e: EntradaRqe, t: RegistroTrilhaTela) {
    return this.executar(c, operacaoIncluirRqe(t), e, t);
  }
  incluirAssinatura(c: ContextoPorta, e: EntradaAssinatura, t: RegistroTrilhaTela) {
    return this.executar(c, operacaoIncluirAssinatura(t), e, t);
  }
  /** Encerra a vigência (dado fiscal, assinatura) ou inativa (conta, RQE); nada se apaga. */
  encerrar(
    c: ContextoPorta,
    tabela: TabelaComplemento,
    e: { profissional: number; id: number; versao: number; fim: string | null },
    t: RegistroTrilhaTela,
  ) {
    return this.executar(c, operacaoEncerrar(tabela, t), e, t);
  }

  /** RQE e assinaturas (dados do corpo clínico, sem valor financeiro). */
  async complemento(c: ContextoPorta, profissional: number): Promise<ComplementoProfissional> {
    return this.ler(c, async (l) => {
      const hoje = await hojeDe(l);
      const rqes = await l.consultar(
        `SELECT r.id, r.versao, r.numero_rqe, uf.sigla AS uf, r.especialidade_medica_id, em.descricao, cc.sigla AS conselho,
                r.data_registro, r.ativo
           FROM profissional_rqe r JOIN unidade_federativa uf ON uf.id = r.unidade_federativa_id
           JOIN especialidade_medica em ON em.id = r.especialidade_medica_id
           LEFT JOIN conselho_classe cc ON cc.id = r.conselho_classe_id
          WHERE r.profissional_id = ? AND r.excluido_em IS NULL ORDER BY r.ativo DESC, em.descricao`,
        [profissional],
      );
      const ass = await l.consultar(
        `SELECT id, versao, tipo, arquivo_id, certificado_titular, certificado_numero_serie, certificado_emissor, uso_tiss,
                vigencia_inicio, vigencia_fim, ativo
           FROM profissional_assinatura WHERE profissional_id = ? AND excluido_em IS NULL
          ORDER BY tipo, vigencia_inicio DESC, id DESC`,
        [profissional],
      );
      return {
        rqes: rqes.map((r) => ({
          id: Number(r['id']),
          versao: Number(r['versao']),
          numero: String(r['numero_rqe']),
          uf: String(r['uf']),
          especialidade: Number(r['especialidade_medica_id']),
          especialidadeDescricao: String(r['descricao']),
          conselho: texto(r['conselho']),
          dataRegistro: data(r['data_registro']),
          ativo: bool(r['ativo']),
        })),
        assinaturas: ass.map((a) => {
          const inicio = data(a['vigencia_inicio'])!;
          const fim = data(a['vigencia_fim']);
          return {
            id: Number(a['id']),
            versao: Number(a['versao']),
            tipo: String(a['tipo']),
            arquivo: num(a['arquivo_id']),
            titular: texto(a['certificado_titular']),
            numeroSerie: texto(a['certificado_numero_serie']),
            emissor: texto(a['certificado_emissor']),
            usoTiss: bool(a['uso_tiss']),
            vigenciaInicio: inicio,
            vigenciaFim: fim,
            ativo: bool(a['ativo']),
            vigente: bool(a['ativo']) && inicio <= hoje && (fim === null || fim >= hoje),
          };
        }),
      };
    });
  }

  /** Dados fiscais e contas (acesso restrito ao cargo do repasse, conferido na rota). */
  async financeiro(c: ContextoPorta, profissional: number): Promise<FinanceiroProfissional> {
    return this.ler(c, async (l) => {
      const hoje = await hojeDe(l);
      const fiscais = await l.consultar(
        `SELECT f.*, pj.razao_social FROM profissional_dado_fiscal f LEFT JOIN pessoa_juridica pj ON pj.id = f.pessoa_juridica_id
          WHERE f.profissional_id = ? AND f.excluido_em IS NULL ORDER BY f.vigencia_inicio DESC, f.id DESC`,
        [profissional],
      );
      const contas = await l.consultar(
        `SELECT c.*, b.descricao AS banco_descricao FROM conta_bancaria_profissional c LEFT JOIN banco b ON b.id = c.banco_id
          WHERE c.profissional_id = ? AND c.excluido_em IS NULL ORDER BY c.ativo DESC, c.principal DESC, c.sequencia DESC`,
        [profissional],
      );
      return {
        fiscais: fiscais.map((f) => {
          const inicio = data(f['vigencia_inicio'])!;
          const fim = data(f['vigencia_fim']);
          return {
            id: Number(f['id']),
            versao: Number(f['versao']),
            estabelecimento: num(f['estabelecimento_id']),
            vigenciaInicio: inicio,
            vigenciaFim: fim,
            tipoRecebedor: String(f['tipo_recebedor']),
            pessoaJuridica: num(f['pessoa_juridica_id']),
            empresa: texto(f['razao_social']),
            regime: texto(f['regime_tributario']),
            inscricaoMunicipal: texto(f['inscricao_municipal']),
            pisPasep: texto(f['pis_pasep']),
            aliquotaIss: num(f['aliquota_iss']),
            percentualInss: num(f['percentual_inss']),
            retemIss: bool(f['retem_iss']),
            retemInss: bool(f['retem_inss']),
            retemIrrf: bool(f['retem_irrf']),
            retemPisCofinsCsll: bool(f['retem_pis_cofins_csll']),
            dependentesIrrf: Number(f['dependentes_irrf']),
            incidencia: texto(f['incidencia_imposto']),
            vigente: inicio <= hoje && (fim === null || fim >= hoje),
          };
        }),
        contas: contas.map((x) => ({
          id: Number(x['id']),
          versao: Number(x['versao']),
          banco: num(x['banco_id']),
          bancoDescricao: texto(x['banco_descricao']),
          agencia: texto(x['agencia']),
          numeroConta: texto(x['numero_conta']),
          tipoChavePix: texto(x['tipo_chave_pix']),
          chavePix: texto(x['chave_pix']),
          favorecidoNome: String(x['favorecido_nome']),
          favorecidoTipo: String(x['favorecido_tipo']),
          favorecidoDocumento: String(x['favorecido_documento']),
          principal: bool(x['principal']),
          ativo: bool(x['ativo']),
        })),
      };
    });
  }

  /** Opções dos formulários: bancos, tipos de conta, especialidades e empresas (busca por nome ou CNPJ). */
  async opcoes(c: ContextoPorta, empresa: string | null) {
    return this.ler(c, async (l) => {
      const bancos = await l.consultar(
        `SELECT id, codigo_compensacao, descricao FROM banco WHERE vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE
          ORDER BY codigo_compensacao IS NULL, codigo_compensacao, descricao LIMIT 600`,
        [],
      );
      const tipos = await l.consultar(
        'SELECT id, descricao FROM tipo_conta_bancaria WHERE ativo ORDER BY ordem_exibicao, descricao',
        [],
      );
      const esp = await l.consultar(
        'SELECT id, descricao FROM especialidade_medica WHERE ativo ORDER BY descricao LIMIT 1000',
        [],
      );
      const termo = (empresa ?? '').trim();
      const empresas =
        termo.length >= 3
          ? await l.consultar(
              `SELECT id, razao_social, cnpj FROM pessoa_juridica WHERE excluido_em IS NULL
                 AND (razao_social LIKE ? OR cnpj = ?) ORDER BY razao_social LIMIT 20`,
              [`%${termo}%`, termo.replace(/\D+/g, '')],
            )
          : [];
      return {
        bancos: bancos.map((b) => ({
          id: Number(b['id']),
          texto: `${b['codigo_compensacao'] ? `${String(b['codigo_compensacao'])} · ` : ''}${String(b['descricao'])}`,
        })),
        tiposConta: tipos.map((t) => ({ id: Number(t['id']), texto: String(t['descricao']) })),
        especialidades: esp.map((t) => ({ id: Number(t['id']), texto: String(t['descricao']) })),
        empresas: empresas.map((t) => ({
          id: Number(t['id']),
          texto: String(t['razao_social']),
          cnpj: texto(t['cnpj']),
        })),
      };
    });
  }
}
