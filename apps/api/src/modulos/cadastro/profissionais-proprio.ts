// D-PROF-39 sobre o banco próprio (fecho-1): as gravações do profissional pelo Executor do núcleo, com as mesmas regras
// da memória (profissionais-memoria.ts), trilha, outbox e idempotência na mesma transação. Modelo: profissional e
// pessoa_fisica (dados), inscricao_conselho (registro: conselho, UF, número, CBO, situação), profissional_ocupacao
// (CBO), profissional_especialidade (especialidade pelo registro) e profissional_fonte_pagadora (credenciamento do
// registro no convênio, com vigência). Melhorias: a pessoa que já existe (paciente, colaborador) ganha o papel de
// profissional sem duplicar a pessoa; o descredenciamento fecha a vigência (nunca apaga); a exclusão por engano marca
// excluido_em (nada some do banco). Pendentes (pedido de modelo): a lotação por unidade assistencial (lotacao_profissional
// não tem a unidade) e o vínculo do login (histórico próprio do vínculo, com o motivo), que respondem 501.
import {
  esquemaAlterarProfissional,
  esquemaAlterarRegistroProfissional,
  esquemaCadastrarProfissional,
  esquemaCredenciamentoProfissional,
  esquemaEspecialidadeProfissional,
  esquemaExcluirProfissional,
  esquemaExcluirRegistroProfissional,
  esquemaIncluirRegistroProfissional,
  esquemaSituacaoProfissional,
  type RegistroNovoProfissional,
} from '@sgh/contratos';
import {
  definirOperacao,
  erroConflitoVersao,
  type Leitor,
  type Operacao,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import type { OperacaoProfissionalTela } from './profissionais-memoria.js';

type Resultado = Record<string, number>;

/** A versão da tela é `v<inteiro>` (coluna versao); outra forma recusa. */
export function versaoDaTela(v: string): number {
  const m = /^v(\d{1,9})$/.exec(v.trim());
  if (!m) throw recusa('versao-invalida', 'A versão lida pela tela é inválida. Releia o cadastro.');
  return Number(m[1]);
}

const hojeDe = async (l: Leitor): Promise<string> => {
  const x = await l.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d');
  const d = x?.d;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
};

async function idPor(l: Leitor, sql: string, p: readonly unknown[]): Promise<number | null> {
  const x = await l.uma<{ id: unknown }>(sql, p);
  return x ? Number(x.id) : null;
}

/** Conselho, UF, CBO e convênios do registro novo, conferidos no catálogo (o mesmo das recusas da memória). */
async function conferirRegistroNovo(
  tx: TxOperacao,
  r: RegistroNovoProfissional,
  profissional: number | null,
) {
  const cbo = await idPor(tx, 'SELECT id FROM ocupacao_cbo WHERE id = ? AND ativo', [r.cbo]);
  if (!cbo) throw recusa('cbo-inexistente', 'Ocupação (CBO) não encontrada.', { campos: ['registro.cbo'] });
  const conselho = await idPor(tx, 'SELECT id FROM conselho_classe WHERE sigla = ? AND ativo', [r.conselho]);
  if (!conselho)
    throw recusa('conselho-inexistente', 'Conselho não encontrado no cadastro de conselhos.', {
      campos: ['conselho'],
    });
  // O banco próprio não tem a subdivisão do conselho (sigla): a tela não a oferece (lista vazia); vinda, recusa.
  if (r.sigla !== undefined)
    throw recusa('sigla-incompativel', 'A sigla não pertence a este conselho.', { campos: ['sigla'] });
  const uf = await idPor(tx, 'SELECT id FROM unidade_federativa WHERE sigla = ?', [r.uf]);
  if (!uf) throw recusa('uf-inexistente', 'UF não encontrada.', { campos: ['registro.uf'] });
  const outro = await tx.uma(
    `SELECT ic.id FROM inscricao_conselho ic WHERE ic.conselho_classe_id = ? AND ic.unidade_federativa_id = ?
        AND ic.numero_inscricao = ? AND ic.situacao IN ('ativa', 'provisoria') AND ic.excluido_em IS NULL
        AND ic.profissional_id <> ?`,
    [conselho, uf, String(r.numero), profissional ?? 0],
  );
  if (outro)
    throw recusa(
      'registro-repetido',
      'Este número de conselho e UF já está no cadastro de outro profissional.',
      {
        campos: ['registro.numero'],
      },
    );
  for (const c of r.convenios)
    if (
      !(await idPor(
        tx,
        "SELECT id FROM fonte_pagadora WHERE id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
        [c],
      ))
    )
      throw recusa('convenio-inativo', 'Só convênio ativo recebe credenciamento.', {
        campos: ['registro.convenios'],
      });
  return { cbo, conselho, uf };
}

/** Inclui o registro (inscrição, ocupação e credenciamentos); o mesmo CBO, UF e número no profissional recusa. */
async function incluirRegistro(
  tx: TxOperacao,
  profissional: number,
  r: RegistroNovoProfissional,
): Promise<number> {
  const { cbo, conselho, uf } = await conferirRegistroNovo(tx, r, profissional);
  const repetido = await tx.uma(
    `SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND ocupacao_cbo_id = ? AND unidade_federativa_id = ?
        AND numero_inscricao = ? AND excluido_em IS NULL`,
    [profissional, cbo, uf, String(r.numero)],
  );
  if (repetido)
    throw recusa('registro-repetido', 'O profissional já tem este registro com esta ocupação.', {
      campos: ['registro.numero'],
    });
  const seq = await tx.uma<{ s: unknown; n: unknown }>(
    `SELECT COALESCE(MAX(sequencia), 0) + 1 AS s, SUM(principal AND excluido_em IS NULL) AS n
       FROM inscricao_conselho WHERE profissional_id = ?`,
    [profissional],
  );
  const registro = await tx.incluir('inscricao_conselho', {
    profissional_id: profissional,
    sequencia: Number(seq?.s ?? 1),
    conselho_classe_id: conselho,
    unidade_federativa_id: uf,
    numero_inscricao: String(r.numero),
    ocupacao_cbo_id: cbo,
    principal: Number(seq?.n ?? 0) === 0,
    situacao: 'ativa',
  });
  const oc = await tx.uma<{ id: unknown; ativo: unknown }>(
    'SELECT id, ativo FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
    [profissional, cbo],
  );
  if (!oc) {
    const temPrincipal = await tx.uma(
      'SELECT id FROM profissional_ocupacao WHERE principal_profissional_id = ?',
      [profissional],
    );
    await tx.incluir('profissional_ocupacao', {
      profissional_id: profissional,
      ocupacao_cbo_id: cbo,
      principal: !temPrincipal,
      ativo: true,
    });
  }
  const hoje = await hojeDe(tx);
  for (const c of new Set(r.convenios))
    await tx.incluir('profissional_fonte_pagadora', {
      profissional_id: profissional,
      fonte_pagadora_id: c,
      inscricao_conselho_id: registro,
      vigencia_inicio: hoje,
      credenciado: true,
    });
  return registro;
}

interface RegistroLido {
  id: number;
  profissional: number;
  versao: number;
  situacao: string;
  conselho: number;
  uf: number;
  numero: string;
}

async function registroReal(tx: TxOperacao, id: number): Promise<RegistroLido> {
  const [x] = await tx.consultarParaAtualizar(
    `SELECT id, profissional_id, versao, situacao, conselho_classe_id, unidade_federativa_id, numero_inscricao
       FROM inscricao_conselho WHERE id = ? AND excluido_em IS NULL`,
    [id],
  );
  if (!x) throw recusa('registro-inexistente', 'Registro não encontrado.');
  return {
    id: Number(x['id']),
    profissional: Number(x['profissional_id']),
    versao: Number(x['versao']),
    situacao: String(x['situacao']),
    conselho: Number(x['conselho_classe_id']),
    uf: Number(x['unidade_federativa_id']),
    numero: String(x['numero_inscricao']),
  };
}

const ATIVA = new Set(['ativa', 'provisoria']);

/** O mesmo conselho, número e UF não fica ativo em dois profissionais. */
async function conferirUnico(tx: TxOperacao, r: RegistroLido, conselho: number): Promise<void> {
  const outro = await tx.uma<{ sigla: unknown; uf: unknown }>(
    `SELECT cc.sigla, uf.sigla AS uf FROM inscricao_conselho ic JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
       JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
      WHERE ic.conselho_classe_id = ? AND ic.unidade_federativa_id = ? AND ic.numero_inscricao = ?
        AND ic.situacao IN ('ativa', 'provisoria') AND ic.excluido_em IS NULL AND ic.profissional_id <> ? LIMIT 1`,
    [conselho, r.uf, r.numero, r.profissional],
  );
  if (outro)
    throw recusa(
      'registro-repetido',
      `O registro ${String(outro.sigla)} ${r.numero}/${String(outro.uf)} está ativo no cadastro de outro profissional.`,
    );
}

async function profissionalReal(tx: TxOperacao, id: number) {
  const [x] = await tx.consultarParaAtualizar(
    'SELECT id, pessoa_fisica_id, versao, situacao, celular FROM profissional WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  if (!x) throw recusa('profissional-inexistente', 'Profissional não encontrado.');
  return x;
}

/** O que impede excluir: atendimentos do profissional (o mesmo critério da leitura `vinculosProfissional`). */
async function atendimentos(tx: TxOperacao, profissional: number): Promise<number> {
  const x = await tx.uma<{ n: unknown }>(
    'SELECT COUNT(*) AS n FROM atendimento WHERE profissional_id = ? AND excluido_em IS NULL',
    [profissional],
  );
  return Number(x?.n ?? 0);
}

const TABELAS_REGISTRO = [
  'inscricao_conselho',
  'profissional_ocupacao',
  'profissional_fonte_pagadora',
] as const;

const operacoes = {
  'cadastro.cadastrarProfissional': definirOperacao({
    nome: 'cadastro.cadastrar-profissional',
    tabelas: ['pessoa_fisica', 'profissional', ...TABELAS_REGISTRO],
    entrada: esquemaCadastrarProfissional,
    acao: 'inclusao',
    async gravar(tx, e): Promise<Resultado> {
      const [pessoa] = await tx.consultarParaAtualizar(
        'SELECT id FROM pessoa_fisica WHERE cpf = ? AND excluido_em IS NULL',
        [e.cpf],
      );
      if (pessoa) {
        const ja = await tx.uma('SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pessoa['id']]);
        if (ja)
          throw recusa(
            'cpf-existente',
            'Já existe um profissional com este CPF. Abra o cadastro dele para incluir o registro.',
            { campos: ['cpf'] },
          );
      }
      const sexo = e.sexo ? await idPor(tx, 'SELECT id FROM sexo WHERE sigla = ?', [e.sexo]) : null;
      // A pessoa que já existe ganha o papel (os dados dela ficam: a tela do profissional não os sobrescreve).
      const pessoaId = pessoa
        ? Number(pessoa['id'])
        : await tx.incluir('pessoa_fisica', {
            nome: e.nome,
            nome_social: e.nomeSocial ?? null,
            cpf: e.cpf,
            cns: e.cns ?? null,
            data_nascimento: e.nascimento ?? null,
            sexo_id: sexo,
            nome_mae: e.nomeMae ?? null,
          });
      const profissional = await tx.incluir('profissional', {
        pessoa_fisica_id: pessoaId,
        tipo: 'assistencial',
        situacao: 'ativo',
        email_profissional: e.email ?? null,
        celular: e.celular ?? null,
      });
      const registro = await incluirRegistro(tx, profissional, e.registro);
      return { profissional, registro };
    },
    alvo: (_e, r) => ({ tabela: 'profissional', id: r['profissional'] ?? null }),
  }),

  'cadastro.alterarProfissional': definirOperacao({
    nome: 'cadastro.alterar-profissional',
    tabelas: ['pessoa_fisica', 'profissional'],
    entrada: esquemaAlterarProfissional,
    acao: 'alteracao',
    async gravar(tx, e): Promise<Resultado> {
      const lida = versaoDaTela(e.versao);
      const p = await profissionalReal(tx, e.profissional);
      if (Number(p['versao']) !== lida) throw erroConflitoVersao(['versao']);
      const [pf] = await tx.consultarParaAtualizar(
        `SELECT pf.id, pf.versao, pf.nome, pf.nome_social, sx.sigla AS sexo, pf.data_nascimento, pf.nome_mae
           FROM pessoa_fisica pf LEFT JOIN sexo sx ON sx.id = pf.sexo_id WHERE pf.id = ?`,
        [p['pessoa_fisica_id']],
      );
      const [atual] = await tx.consultar(
        'SELECT email_profissional, celular FROM profissional WHERE id = ?',
        [e.profissional],
      );
      const a = e.alteracoes;
      const igual = (x: unknown, y: unknown) =>
        (x instanceof Date ? x.toISOString().slice(0, 10) : (x ?? null)) === (y ?? null);
      const dPessoa: Record<string, unknown> = {};
      if (a.nome !== undefined && !igual(pf?.['nome'], a.nome)) dPessoa['nome'] = a.nome;
      if (a.nomeSocial !== undefined && !igual(pf?.['nome_social'], a.nomeSocial))
        dPessoa['nome_social'] = a.nomeSocial;
      if (a.sexo !== undefined && !igual(pf?.['sexo'], a.sexo))
        dPessoa['sexo_id'] = a.sexo ? await idPor(tx, 'SELECT id FROM sexo WHERE sigla = ?', [a.sexo]) : null;
      if (a.nascimento !== undefined && !igual(pf?.['data_nascimento'], a.nascimento))
        dPessoa['data_nascimento'] = a.nascimento;
      if (a.nomeMae !== undefined && !igual(pf?.['nome_mae'], a.nomeMae)) dPessoa['nome_mae'] = a.nomeMae;
      const dProf: Record<string, unknown> = {};
      if (a.email !== undefined && !igual(atual?.['email_profissional'], a.email))
        dProf['email_profissional'] = a.email;
      if (a.celular !== undefined && !igual(atual?.['celular'], a.celular)) dProf['celular'] = a.celular;
      if (Object.keys(dPessoa).length + Object.keys(dProf).length === 0)
        throw recusa('sem-alteracao', 'Nenhum campo mudou em relação ao cadastro.');
      if (pf && Object.keys(dPessoa).length > 0)
        await tx.alterar('pessoa_fisica', Number(pf['id']), Number(pf['versao']), dPessoa);
      // A versão do profissional sobe sempre (a tela relê pela versão do profissional).
      await tx.alterar('profissional', e.profissional, lida, {
        celular: atual?.['celular'] ?? null,
        ...dProf,
      });
      return { profissional: e.profissional };
    },
    alvo: (e) => ({ tabela: 'profissional', id: e.profissional }),
  }),

  'cadastro.incluirRegistroProfissional': definirOperacao({
    nome: 'cadastro.incluir-registro-profissional',
    tabelas: [...TABELAS_REGISTRO],
    entrada: esquemaIncluirRegistroProfissional,
    acao: 'inclusao',
    async gravar(tx, e): Promise<Resultado> {
      await profissionalReal(tx, e.profissional);
      return { registro: await incluirRegistro(tx, e.profissional, e), profissional: e.profissional };
    },
    alvo: (_e, r) => ({ tabela: 'inscricao_conselho', id: r['registro'] ?? null }),
  }),

  'cadastro.alterarRegistroProfissional': definirOperacao({
    nome: 'cadastro.alterar-registro-profissional',
    tabelas: ['inscricao_conselho'],
    entrada: esquemaAlterarRegistroProfissional,
    acao: 'alteracao',
    async gravar(tx, e): Promise<Resultado> {
      const lida = versaoDaTela(e.versao);
      const r = await registroReal(tx, e.registro);
      if (r.versao !== lida) throw erroConflitoVersao(['versao']);
      const a = e.alteracoes;
      let conselho = r.conselho;
      if (a.conselho !== undefined) {
        const c = await idPor(tx, 'SELECT id FROM conselho_classe WHERE sigla = ? AND ativo', [a.conselho]);
        if (!c)
          throw recusa('conselho-inexistente', 'Conselho não encontrado no cadastro de conselhos.', {
            campos: ['conselho'],
          });
        conselho = c;
      }
      if (a.sigla !== undefined && a.sigla !== null)
        throw recusa('sigla-incompativel', 'A sigla não pertence a este conselho.', { campos: ['sigla'] });
      const ativoAntes = ATIVA.has(r.situacao);
      const ativo = a.ativo ?? ativoAntes;
      if (conselho === r.conselho && ativo === ativoAntes)
        throw recusa('sem-alteracao', 'Nenhum campo mudou em relação ao registro.');
      if (ativo && (a.ativo === true || a.conselho !== undefined)) await conferirUnico(tx, r, conselho);
      await tx.alterar('inscricao_conselho', r.id, lida, {
        conselho_classe_id: conselho,
        situacao: ativo === ativoAntes ? r.situacao : ativo ? 'ativa' : 'inativa',
      });
      return { registro: r.id, profissional: r.profissional };
    },
    alvo: (e) => ({ tabela: 'inscricao_conselho', id: e.registro }),
    trilha: (e) => ({ motivo: e.motivo ?? null }),
  }),

  'cadastro.definirEspecialidadeProfissional': definirOperacao({
    nome: 'cadastro.definir-especialidade-profissional',
    tabelas: ['profissional_especialidade'],
    entrada: esquemaEspecialidadeProfissional,
    acao: 'alteracao',
    async gravar(tx, e): Promise<Resultado> {
      const r = await registroReal(tx, e.registro);
      if (!(await idPor(tx, 'SELECT id FROM especialidade_medica WHERE id = ? AND ativo', [e.especialidade])))
        throw recusa('especialidade-inexistente', 'Especialidade não encontrada.', {
          campos: ['especialidade'],
        });
      // O modelo guarda a especialidade por profissional, com o registro pelo qual ele a exerce.
      const [x] = await tx.consultarParaAtualizar(
        `SELECT id, versao, ativo, inscricao_conselho_id FROM profissional_especialidade
          WHERE profissional_id = ? AND especialidade_medica_id = ? AND excluido_em IS NULL`,
        [r.profissional, e.especialidade],
      );
      if (x) {
        const ativo = x['ativo'] === true || Number(x['ativo']) === 1;
        if (ativo === e.ativo && Number(x['inscricao_conselho_id'] ?? 0) === r.id)
          throw recusa('sem-alteracao', 'A especialidade já está nesta situação.');
        await tx.alterar('profissional_especialidade', Number(x['id']), Number(x['versao']), {
          ativo: e.ativo,
          inscricao_conselho_id: r.id,
        });
      } else
        await tx.incluir('profissional_especialidade', {
          profissional_id: r.profissional,
          especialidade_medica_id: e.especialidade,
          inscricao_conselho_id: r.id,
          ativo: e.ativo,
        });
      return { registro: r.id, profissional: r.profissional };
    },
    alvo: (e) => ({ tabela: 'inscricao_conselho', id: e.registro }),
  }),

  'cadastro.credenciarProfissional': definirOperacao({
    nome: 'cadastro.credenciar-profissional',
    tabelas: ['profissional_fonte_pagadora'],
    entrada: esquemaCredenciamentoProfissional,
    acao: 'alteracao',
    async gravar(tx, e): Promise<Resultado> {
      const r = await registroReal(tx, e.registro);
      const hoje = await hojeDe(tx);
      const vigentes = await tx.consultarParaAtualizar(
        `SELECT id, versao, vigencia_inicio FROM profissional_fonte_pagadora
          WHERE profissional_id = ? AND fonte_pagadora_id = ? AND inscricao_conselho_id = ? AND estabelecimento_id IS NULL
            AND plano_fonte_pagadora_id IS NULL AND credenciado AND excluido_em IS NULL
            AND (vigencia_fim IS NULL OR vigencia_fim > ?)`,
        [r.profissional, e.convenio, r.id, hoje],
      );
      if (e.credenciado) {
        if (
          !(await idPor(
            tx,
            "SELECT id FROM fonte_pagadora WHERE id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
            [e.convenio],
          ))
        )
          throw recusa('convenio-inativo', 'Só convênio ativo recebe credenciamento.', {
            campos: ['convenio'],
          });
        if (vigentes.length > 0) throw recusa('sem-alteracao', 'O registro já é credenciado neste convênio.');
        // Fechado hoje e credenciado de novo no mesmo dia: a vigência reabre (a chave inclui o início).
        const [mesmoDia] = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM profissional_fonte_pagadora WHERE profissional_id = ? AND fonte_pagadora_id = ?
              AND inscricao_conselho_id = ? AND estabelecimento_id IS NULL AND plano_fonte_pagadora_id IS NULL
              AND vigencia_inicio = ? AND excluido_em IS NULL`,
          [r.profissional, e.convenio, r.id, hoje],
        );
        if (mesmoDia)
          await tx.alterar(
            'profissional_fonte_pagadora',
            Number(mesmoDia['id']),
            Number(mesmoDia['versao']),
            {
              vigencia_fim: null,
              credenciado: true,
            },
          );
        else
          await tx.incluir('profissional_fonte_pagadora', {
            profissional_id: r.profissional,
            fonte_pagadora_id: e.convenio,
            inscricao_conselho_id: r.id,
            vigencia_inicio: hoje,
            credenciado: true,
          });
      } else {
        if (vigentes.length === 0)
          throw recusa('sem-alteracao', 'O registro não é credenciado neste convênio.');
        // O descredenciamento fecha a vigência hoje (o histórico do credenciamento fica).
        for (const v of vigentes)
          await tx.alterar('profissional_fonte_pagadora', Number(v['id']), Number(v['versao']), {
            vigencia_fim: hoje,
          });
      }
      return { registro: r.id, profissional: r.profissional };
    },
    alvo: (e) => ({ tabela: 'inscricao_conselho', id: e.registro }),
  }),

  'cadastro.inativarProfissional': situacao(false),
  'cadastro.reativarProfissional': situacao(true),

  'cadastro.excluirProfissional': definirOperacao({
    nome: 'cadastro.excluir-profissional',
    tabelas: ['profissional', ...TABELAS_REGISTRO],
    entrada: esquemaExcluirProfissional,
    acao: 'exclusao',
    critica: true,
    async gravar(tx, e): Promise<Resultado> {
      const p = await profissionalReal(tx, e.profissional);
      const n = await atendimentos(tx, e.profissional);
      if (n > 0)
        throw recusa(
          'profissional-com-vinculos',
          `Este profissional tem vínculos (Atendimentos: ${n}). Não pode ser excluído: inative o cadastro.`,
        );
      // Exclusão do cadastro feito por engano: marca excluido_em (a pessoa e a trilha ficam; nada some do banco).
      const agora = new Date();
      for (const r of await tx.consultar(
        'SELECT id, versao FROM inscricao_conselho WHERE profissional_id = ? AND excluido_em IS NULL',
        [e.profissional],
      ))
        await tx.alterar('inscricao_conselho', Number(r['id']), Number(r['versao']), {
          excluido_em: agora,
          excluido_por: tx.contexto.usuario,
        });
      await tx.alterar('profissional', e.profissional, Number(p['versao']), {
        excluido_em: agora,
        excluido_por: tx.contexto.usuario,
      });
      return { profissional: e.profissional };
    },
    alvo: (e) => ({ tabela: 'profissional', id: e.profissional }),
    trilha: (e) => ({ motivo: e.motivo }),
  }),

  'cadastro.excluirRegistroProfissional': definirOperacao({
    nome: 'cadastro.excluir-registro-profissional',
    tabelas: ['inscricao_conselho', 'profissional_especialidade', 'profissional_fonte_pagadora'],
    entrada: esquemaExcluirRegistroProfissional,
    acao: 'exclusao',
    critica: true,
    async gravar(tx, e): Promise<Resultado> {
      const r = await registroReal(tx, e.registro);
      // Atos do registro: os atendimentos do profissional (o modelo não liga o atendimento ao registro).
      const outros = await tx.uma<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM inscricao_conselho WHERE profissional_id = ? AND id <> ? AND excluido_em IS NULL',
        [r.profissional, r.id],
      );
      const n = Number(outros?.n ?? 0) === 0 ? await atendimentos(tx, r.profissional) : 0;
      if (n > 0)
        throw recusa(
          'registro-com-atos',
          `Este registro tem vínculos (Atendimentos: ${n}). Não pode ser excluído: encerre o registro (inativar).`,
        );
      const agora = new Date();
      for (const t of ['profissional_especialidade', 'profissional_fonte_pagadora'] as const)
        for (const x of await tx.consultar(
          `SELECT id, versao FROM ${t} WHERE inscricao_conselho_id = ? AND excluido_em IS NULL`,
          [r.id],
        ))
          await tx.alterar(t, Number(x['id']), Number(x['versao']), {
            excluido_em: agora,
            excluido_por: tx.contexto.usuario,
          });
      await tx.alterar('inscricao_conselho', r.id, r.versao, {
        excluido_em: agora,
        excluido_por: tx.contexto.usuario,
        principal: false,
      });
      return { registro: r.id, profissional: r.profissional };
    },
    alvo: (e) => ({ tabela: 'inscricao_conselho', id: e.registro }),
    trilha: (e) => ({ motivo: e.motivo }),
  }),
};

/** Toda chave é uma operação da tela (erro de digitação na chave não compila). */
const _chaves: readonly OperacaoProfissionalTela[] = Object.keys(operacoes) as (keyof typeof operacoes)[];
void _chaves;

/**
 * Inativar: todos os registros ativos ficam inativos e o profissional inativo (data e motivo). Reativar: volta só o
 * que a inativação do profissional desligou (registros inativados a partir da data da inativação), conferindo que o
 * registro não está ativo em outro profissional.
 */
function situacao(ativar: boolean) {
  return definirOperacao({
    nome: ativar ? 'cadastro.reativar-profissional' : 'cadastro.inativar-profissional',
    tabelas: ['profissional', 'inscricao_conselho'],
    entrada: esquemaSituacaoProfissional,
    acao: 'alteracao',
    async gravar(tx, e): Promise<Resultado> {
      const p = await profissionalReal(tx, e.profissional);
      const regs = await tx.consultarParaAtualizar(
        `SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND excluido_em IS NULL
            AND situacao ${ativar ? "= 'inativa'" : "IN ('ativa', 'provisoria')"}
            ${ativar ? 'AND (SELECT data_inativacao FROM profissional WHERE id = ?) <= DATE(COALESCE(alterado_em, criado_em))' : ''}`,
        ativar ? [e.profissional, e.profissional] : [e.profissional],
      );
      if (regs.length === 0) {
        if (!ativar) throw recusa('ja-inativo', 'O profissional já está inativo (nenhum registro ativo).');
        throw String(p['situacao']) === 'inativo'
          ? recusa(
              'reativar-registro-a-registro',
              'Os registros deste profissional não foram desligados por uma inativação deste sistema. Reative na aba Registros só os que devem voltar, um a um, com o motivo.',
            )
          : recusa('ja-ativo', 'O profissional não tem registro inativo para reativar.');
      }
      for (const x of regs) {
        const r = await registroReal(tx, Number(x['id']));
        if (ativar) await conferirUnico(tx, r, r.conselho);
        await tx.alterar('inscricao_conselho', r.id, r.versao, { situacao: ativar ? 'ativa' : 'inativa' });
      }
      await tx.alterar(
        'profissional',
        e.profissional,
        Number(p['versao']),
        ativar
          ? { situacao: 'ativo', data_inativacao: null, motivo_inativacao: null }
          : { situacao: 'inativo', data_inativacao: await hojeDe(tx), motivo_inativacao: e.motivo },
      );
      return { profissional: e.profissional, registros: regs.length };
    },
    alvo: (e) => ({ tabela: 'profissional', id: e.profissional }),
    trilha: (e) => ({ motivo: e.motivo }),
  });
}

/** A operação do Executor para a gravação da tela; null quando ainda pende de modelo (501 na porta). */
export function operacaoProfissionalPropria(
  op: OperacaoProfissionalTela,
): Operacao<unknown, Resultado> | null {
  return ((operacoes as Record<string, unknown>)[op] as Operacao<unknown, Resultado> | undefined) ?? null;
}
