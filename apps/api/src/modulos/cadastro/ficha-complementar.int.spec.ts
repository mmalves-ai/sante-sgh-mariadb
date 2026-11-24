// Contrato de efeito da ficha complementar do paciente (F3.1, 02-CAD linhas 2, 3 e 4) contra o MariaDB real, no
// cliente de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real): o que cada
// operação deixa no banco (regra de campo, contatos, responsáveis) e o que nunca apaga. A massa sai no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gravarComRegra } from './cadastro-com-regra.js';
import { FichaComplementarPropria } from './ficha-complementar-proprio.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const CPF_ADULTO = cpfSintetico('990102311');
const CPF_MENOR = cpfSintetico('990102312');
const CPF_MAE = cpfSintetico('990102313');
const CPF_TIO = cpfSintetico('990102314');
const CPF_NOVO = cpfSintetico('990102315');
const CPF_SEM_DATA = cpfSintetico('990102316');
const CPF_PRIMO = cpfSintetico('990102317');

async function limparFicha(nucleo: NucleoProprio, m: Massa | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-ficha-limpa' }, async (e) => {
    await e.executar(
      `DELETE r FROM responsavel_paciente r JOIN pessoa_fisica pf ON pf.id = r.pessoa_fisica_id OR pf.id =
         (SELECT p.pessoa_fisica_id FROM paciente p WHERE p.id = r.paciente_id) WHERE pf.nome LIKE ?`,
      [`%${MARCA}%`],
    );
    await e.executar('DELETE FROM regra_campo_cadastro WHERE estabelecimento_id = ? OR rotulo = ?', [
      m.estabelecimento,
      MARCA,
    ]);
    // O aceite do e-mail vira consentimento do titular: solta o e-mail e apaga o consentimento da massa.
    const doTeste = `SELECT p.id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?`;
    await e.executar(
      `UPDATE email_pessoa SET consentimento_titular_id = NULL WHERE consentimento_titular_id IN
         (SELECT id FROM consentimento_titular WHERE paciente_id IN (${doTeste}))`,
      [`%${MARCA}%`],
    );
    await e.executar(
      `DELETE h FROM consentimento_titular_historico h JOIN consentimento_titular k ON k.id = h.consentimento_titular_id
        WHERE k.paciente_id IN (${doTeste})`,
      [`%${MARCA}%`],
    );
    await e.executar(`DELETE FROM consentimento_titular WHERE paciente_id IN (${doTeste})`, [`%${MARCA}%`]);
  });
}

describe.skipIf(SEM_BANCO)('ficha complementar do paciente no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let ficha: FichaComplementarPropria;
  let m: Massa | null = null;
  let adulto = 0;
  let menor = 0;
  let tipoEndereco = 0;
  let telMensagem = 0;
  let telRecado = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-ficha-conta' }, (l) => l.uma<T>(sql, p));
  const trilha = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.ficha-complementar' },
    correlacao: 'f22-0102-ficha',
  });
  const c = () => contextoPorta(m!, 'f22-0102-ficha');
  const codigo = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'gravou',
      (x: { codigo?: string; tipo?: string }) => x.codigo ?? x.tipo ?? String(x),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    await limparFicha(nucleo, m);
    await limparMassa(nucleo, m);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const paciente = async (nome: string, nascimento: string, cpf: string) =>
      (
        await cadastro.cadastrar(
          contextoPorta(m!),
          {
            nome,
            nascimento,
            sexo: 'F',
            cpf,
            naturalidade: 'BELO HORIZONTE',
            ufNaturalidade: 'MG',
            cep: CEP_TESTE,
            numero: 10,
          },
          contextoGravacao(m!),
        )
      ).resultado.idPaciente;
    adulto = await paciente(`ADULTO FICHA ${MARCA}`, '1980-05-17', CPF_ADULTO);
    menor = await paciente(`MENOR FICHA ${MARCA}`, '2016-03-02', CPF_MENOR);
    ficha = new FichaComplementarPropria(nucleo, CLIENTE_F22);
    const t = await ficha.tipos(c());
    tipoEndereco = t.endereco[0]!.id;
    const tel = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-ficha-tipos' }, (l) =>
      l.consultar('SELECT id, permite_mensagem, recado FROM tipo_telefone WHERE ativo ORDER BY id', []),
    );
    telMensagem = Number(
      tel.find((x) => Number(x['permite_mensagem']) === 1 && Number(x['recado']) !== 1)?.['id'] ?? 0,
    );
    telRecado = Number(tel.find((x) => Number(x['recado']) === 1)?.['id'] ?? 0);
    expect(tipoEndereco * telMensagem * telRecado).toBeGreaterThan(0);
  }, 180_000);

  afterAll(async () => {
    await limparFicha(nucleo, m).catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('regra de campo: grava, atualiza no mesmo escopo, recusa campo fixo, aplica no cadastro e é inativada', async () => {
    const base = {
      estabelecimento: m!.estabelecimento,
      campo: 'email',
      modulo: null,
      tipoAtendimento: 'todos' as const,
      fontePagadora: null,
      rotulo: null,
    };
    const id = await ficha.gravarRegraCampo(
      c(),
      { ...base, exigencia: 'opcional' },
      trilha('regra_campo_cadastro'),
    );
    expect(
      await ficha.gravarRegraCampo(c(), { ...base, exigencia: 'obrigatorio', rotulo: 'E-mail' }, trilha('r')),
    ).toBe(id);
    const r = await um(
      'SELECT exigencia, rotulo, ativo, versao, entidade FROM regra_campo_cadastro WHERE id = ?',
      [id],
    );
    expect(r).toMatchObject({ exigencia: 'obrigatorio', rotulo: 'E-mail', entidade: 'paciente' });
    expect(Number(r?.['versao'])).toBe(2);
    expect(
      await codigo(ficha.gravarRegraCampo(c(), { ...base, campo: 'cpf', exigencia: 'oculto' }, trilha('r'))),
    ).toBe('regra-invalida');
    expect(await codigo(ficha.conferirCampos(c(), { nome: 'X' }, 'cadastro'))).toBe('campos-exigidos');
    expect(await codigo(ficha.conferirCampos(c(), { email: 'a@b.co' }, 'cadastro'))).toBe('gravou');
    expect(await codigo(ficha.conferirCampos(c(), { email: null }, 'alteracao'))).toBe('campos-exigidos');
    expect(await codigo(ficha.conferirCampos(c(), { nome: 'Y' }, 'alteracao'))).toBe('gravou');
    // Abertura do atendimento: a regra da fonte pagadora vale só para ela.
    await ficha.gravarRegraCampo(
      c(),
      { ...base, campo: 'nomeMae', fontePagadora: m!.fonte, exigencia: 'obrigatorio' },
      trilha('r'),
    );
    const semFonte = await ficha.camposPendentes(c(), adulto, {
      modulo: null,
      tipoAtendimento: null,
      fontePagadora: null,
    });
    const comFonte = await ficha.camposPendentes(c(), adulto, {
      modulo: null,
      tipoAtendimento: 'ambulatorial',
      fontePagadora: m!.fonte,
    });
    expect(semFonte.map((x) => x.campo)).toEqual(['email']);
    expect(comFonte.map((x) => x.campo)).toEqual(['email', 'nomeMae']);
    // O caminho do POST pacientes: a regra da fonte pagadora recusa o cadastro nela e nada é gravado.
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const novo = {
      nome: `NOVO FICHA ${MARCA}`,
      nascimento: '1990-02-03',
      sexo: 'F' as const,
      cpf: CPF_NOVO,
      naturalidade: 'BELO HORIZONTE',
      ufNaturalidade: 'MG',
      cep: CEP_TESTE,
      numero: 11,
      email: 'f22l0102novo@exemplo.invalid',
    };
    const pessoasDoCpf = async () =>
      Number((await um('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [CPF_NOVO]))?.['n']);
    const viaRota = (escopo: Parameters<typeof gravarComRegra>[4]) =>
      gravarComRegra(ficha, c(), novo, 'cadastro', escopo, () =>
        cadastro.cadastrar(contextoPorta(m!), novo as never, contextoGravacao(m!)),
      );
    expect(await codigo(viaRota({ modulo: null, tipoAtendimento: null, fontePagadora: m!.fonte }))).toBe(
      'campos-exigidos',
    );
    expect(await pessoasDoCpf()).toBe(0);
    // Sem a fonte (regra geral), o mesmo cadastro grava.
    expect(await codigo(viaRota({ modulo: null, tipoAtendimento: null, fontePagadora: null }))).toBe(
      'gravou',
    );
    expect(await pessoasDoCpf()).toBe(1);
    // O caminho do PUT: somente leitura por tipo de atendimento recusa a mudança e o paciente fica na mesma versão.
    await ficha.gravarRegraCampo(
      c(),
      { ...base, campo: 'telefone', tipoAtendimento: 'internacao', exigencia: 'somente_leitura' },
      trilha('r'),
    );
    const versao = async () =>
      Number((await um('SELECT versao FROM paciente WHERE id = ?', [adulto]))?.['versao']);
    const v0 = await versao();
    const alterarViaRota = (tipo: 'internacao' | null) =>
      gravarComRegra(
        ficha,
        c(),
        { telefone: '3133334444' },
        'alteracao',
        { modulo: null, tipoAtendimento: tipo, fontePagadora: null },
        () => Promise.resolve('gravou'),
      );
    expect(await codigo(alterarViaRota('internacao'))).toBe('campos-exigidos');
    expect(await alterarViaRota(null)).toBe('gravou');
    expect(await versao()).toBe(v0);
    // Regra de outro estabelecimento: nem gravada nem inativada pela sessão deste.
    const outro = Number(
      (await um('SELECT id FROM estabelecimento WHERE id <> ? ORDER BY id LIMIT 1', [m!.estabelecimento]))?.[
        'id'
      ],
    );
    expect(outro).toBeGreaterThan(0);
    expect(
      await codigo(
        ficha.gravarRegraCampo(
          c(),
          { ...base, estabelecimento: outro, exigencia: 'obrigatorio' },
          trilha('r'),
        ),
      ),
    ).toBe('regra-de-outro-estabelecimento');
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-ficha-outra' }, (x) =>
      x.executar(
        `INSERT INTO regra_campo_cadastro (estabelecimento_id, entidade, campo, tipo_atendimento, exigencia, rotulo, ativo, criado_em)
         VALUES (?, 'paciente', 'email', 'todos', 'obrigatorio', ?, TRUE, NOW(3))`,
        [outro, MARCA],
      ),
    );
    const alheia = Number(
      (
        await um('SELECT id FROM regra_campo_cadastro WHERE rotulo = ? AND estabelecimento_id = ?', [
          MARCA,
          outro,
        ])
      )?.['id'],
    );
    expect(await codigo(ficha.inativarRegraCampo(c(), alheia, 1, trilha('r')))).toBe('regra-inexistente');
    expect(
      Number((await um('SELECT ativo FROM regra_campo_cadastro WHERE id = ?', [alheia]))?.['ativo']),
    ).toBe(1);
    await ficha.inativarRegraCampo(c(), id, 2, trilha('r'));
    expect(Number((await um('SELECT ativo FROM regra_campo_cadastro WHERE id = ?', [id]))?.['ativo'])).toBe(
      0,
    );
    expect(await codigo(ficha.conferirCampos(c(), { nome: 'X' }, 'cadastro'))).toBe('gravou');
  });

  it('contatos: vários endereços com um principal, encerramento sem apagar, aceite de mensagem e de comunicação', async () => {
    const pessoa = Number(
      (await um('SELECT pessoa_fisica_id AS p FROM paciente WHERE id = ?', [adulto]))?.['p'],
    );
    const contar = async (t: string) =>
      Number((await um(`SELECT COUNT(*) AS n FROM ${t} WHERE pessoa_fisica_id = ?`, [pessoa]))?.['n']);
    const end = {
      paciente: adulto,
      tipo: tipoEndereco,
      cep: CEP_TESTE,
      logradouro: null,
      numero: '20',
      semNumero: false,
      complemento: null,
      bairro: null,
      pontoReferencia: null,
      vigenciaInicio: null,
      vigenciaFim: null,
    };
    const e1 = await ficha.incluirEndereco(c(), { ...end, principal: false }, trilha('endereco_pessoa'));
    const e2 = await ficha.incluirEndereco(
      c(),
      { ...end, numero: '30', principal: true },
      trilha('endereco_pessoa'),
    );
    const principais = await um<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM endereco_pessoa WHERE pessoa_fisica_id = ? AND principal AND excluido_em IS NULL',
      [pessoa],
    );
    expect(Number(principais?.n)).toBe(1);
    expect(
      Number((await um('SELECT principal FROM endereco_pessoa WHERE id = ?', [e2]))?.['principal']),
    ).toBe(1);
    const antes = await contar('endereco_pessoa');
    await ficha.ajustarContato(
      c(),
      { paciente: adulto, especie: 'endereco', id: e2, acao: 'encerrar' },
      trilha('e'),
    );
    expect(await contar('endereco_pessoa')).toBe(antes);
    const enc = await um('SELECT vigencia_fim, principal FROM endereco_pessoa WHERE id = ?', [e2]);
    expect(enc?.['vigencia_fim']).not.toBeNull();
    expect(Number(enc?.['principal'])).toBe(0);
    const lidos = await ficha.contatos(c(), adulto);
    // Encerrado no mesmo dia em que entrou: deixa de valer já (intervalo vazio) e não é encerrado de novo.
    expect(lidos.enderecos.find((x) => x.id === e2)?.vigente).toBe(false);
    expect(
      await codigo(
        ficha.ajustarContato(
          c(),
          { paciente: adulto, especie: 'endereco', id: e2, acao: 'encerrar' },
          trilha('e'),
        ),
      ),
    ).toBe('contato-inexistente');
    expect(lidos.enderecos.filter((x) => x.vigente && x.principal)).toHaveLength(1);
    expect(lidos.enderecos.find((x) => x.id === e1)).toBeDefined();

    const tel = {
      paciente: adulto,
      ddi: '55',
      ddd: '31',
      ramal: null,
      principal: true,
      usaAplicativoMensagem: false,
    };
    expect(
      await codigo(
        ficha.incluirTelefone(
          c(),
          { ...tel, tipo: telRecado, numero: '33330000', nomeContato: null, aceitaMensagem: false },
          trilha('t'),
        ),
      ),
    ).toBe('telefone-invalido');
    const t1 = await ficha.incluirTelefone(
      c(),
      { ...tel, tipo: telMensagem, numero: '999990311', nomeContato: null, aceitaMensagem: true },
      trilha('telefone_pessoa'),
    );
    const t = await um(
      'SELECT aceita_mensagem, aceita_mensagem_em, principal FROM telefone_pessoa WHERE id = ?',
      [t1],
    );
    expect(Number(t?.['aceita_mensagem'])).toBe(1);
    expect(t?.['aceita_mensagem_em']).not.toBeNull();
    expect(Number(t?.['principal'])).toBe(1);

    const mail = { paciente: adulto, finalidade: 'notificacao', principal: false };
    expect(
      await codigo(
        ficha.incluirEmail(
          c(),
          { ...mail, email: 'f22l0102@exemplo.invalid', aceitaComunicacao: true, aceiteDeclarado: false },
          trilha('m'),
        ),
      ),
    ).toBe('email-invalido');
    const m1 = await ficha.incluirEmail(
      c(),
      { ...mail, email: 'f22l0102@exemplo.invalid', aceitaComunicacao: true, aceiteDeclarado: true },
      trilha('email_pessoa'),
    );
    expect(
      await um('SELECT finalidade, aceita_comunicacao, principal FROM email_pessoa WHERE id = ?', [m1]),
    ).toMatchObject({
      finalidade: 'notificacao',
    });
    const aceite = await um(
      `SELECT k.situacao, k.autorizado_em, k.criado_por FROM email_pessoa e
         JOIN consentimento_titular k ON k.id = e.consentimento_titular_id WHERE e.id = ?`,
      [m1],
    );
    expect(aceite?.['situacao']).toBe('autorizado');
    expect(aceite?.['autorizado_em']).not.toBeNull();
    expect((await ficha.contatos(c(), adulto)).emails.find((x) => x.id === m1)?.aceiteEm).not.toBeNull();
    // Revogar o aceite sem encerrar o e-mail: o consentimento fica revogado, o contato segue em uso.
    await ficha.ajustarContato(
      c(),
      { paciente: adulto, especie: 'email', id: m1, acao: 'revogar-aceite' },
      trilha('m'),
    );
    const rev = await um(
      `SELECT e.aceita_comunicacao, e.excluido_em, k.situacao, k.revogado_em FROM email_pessoa e
         JOIN consentimento_titular k ON k.id = e.consentimento_titular_id WHERE e.id = ?`,
      [m1],
    );
    expect(Number(rev?.['aceita_comunicacao'])).toBe(0);
    expect(rev?.['excluido_em']).toBeNull();
    expect(rev?.['situacao']).toBe('revogado');
    expect(rev?.['revogado_em']).not.toBeNull();
    const emails = await contar('email_pessoa');
    await ficha.ajustarContato(
      c(),
      { paciente: adulto, especie: 'email', id: m1, acao: 'encerrar' },
      trilha('m'),
    );
    expect(await contar('email_pessoa')).toBe(emails);
    expect(
      (await um('SELECT excluido_em FROM email_pessoa WHERE id = ?', [m1]))?.['excluido_em'],
    ).not.toBeNull();
    // O e-mail que saiu de uso não é incluído de novo: é reativado (a mesma linha).
    expect(
      await codigo(
        ficha.incluirEmail(
          c(),
          { ...mail, email: 'f22l0102@exemplo.invalid', aceitaComunicacao: false, aceiteDeclarado: false },
          trilha('m'),
        ),
      ),
    ).toBe('email-fora-de-uso');
    await ficha.ajustarContato(
      c(),
      { paciente: adulto, especie: 'email', id: m1, acao: 'reativar' },
      trilha('m'),
    );
    expect(await contar('email_pessoa')).toBe(emails);
    expect((await ficha.contatos(c(), adulto)).emails.find((x) => x.id === m1)).toMatchObject({
      ativo: true,
      aceitaComunicacao: false,
    });
  });

  it('responsáveis: pessoa única pelo CPF, poderes, pendência do menor e encerramento que não deixa o menor sem representante', async () => {
    expect((await ficha.responsaveis(c(), menor)).pendencias).toEqual([
      { pendencia: 'menor-sem-representante', vinculo: null },
    ]);
    const base = {
      paciente: menor,
      nascimento: '1985-01-01',
      parentesco: null,
      receberInformacao: true,
      retirarDocumento: true,
      contatoPrincipal: true,
      prioridadeContato: 1,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      comprovante: null,
      observacao: null,
    };
    const mae = await ficha.incluirResponsavel(
      c(),
      {
        ...base,
        cpf: CPF_MAE,
        nome: `MAE FICHA ${MARCA}`,
        papel: 'responsavel_legal',
        autorizarProcedimento: true,
      },
      trilha('responsavel_paciente'),
    );
    const r = await um(
      'SELECT papel, pode_autorizar_procedimento, vigencia_inicio, vigencia_fim FROM responsavel_paciente WHERE id = ?',
      [mae],
    );
    expect(r?.['papel']).toBe('responsavel_legal');
    expect(Number(r?.['pode_autorizar_procedimento'])).toBe(1);
    expect(r?.['vigencia_fim']).toBeNull();
    // A mesma pessoa em outro papel: reaproveitada pelo CPF.
    await ficha.incluirResponsavel(
      c(),
      { ...base, cpf: CPF_MAE, nome: null, papel: 'contato_emergencia', autorizarProcedimento: false },
      trilha('responsavel_paciente'),
    );
    expect(
      Number((await um('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [CPF_MAE]))?.['n']),
    ).toBe(1);
    expect(
      await codigo(
        ficha.incluirResponsavel(
          c(),
          {
            ...base,
            cpf: CPF_TIO,
            nome: `TIO FICHA ${MARCA}`,
            papel: 'familiar',
            autorizarProcedimento: true,
          },
          trilha('r'),
        ),
      ),
    ).toBe('responsavel-invalido');
    expect((await ficha.responsaveis(c(), menor)).pendencias).toEqual([]);
    expect(
      await codigo(
        ficha.encerrarResponsavel(
          c(),
          { paciente: menor, id: mae, levantamentoCuratela: false, motivo: 'troca' },
          trilha('r'),
        ),
      ),
    ).toBe('menor-sem-representante');
    await ficha.incluirResponsavel(
      c(),
      { ...base, cpf: CPF_TIO, nome: `TIO FICHA ${MARCA}`, papel: 'tutor', autorizarProcedimento: true },
      trilha('responsavel_paciente'),
    );
    await ficha.encerrarResponsavel(
      c(),
      { paciente: menor, id: mae, levantamentoCuratela: false, motivo: 'tutela' },
      trilha('r'),
    );
    const fim = await um('SELECT vigencia_fim, excluido_em FROM responsavel_paciente WHERE id = ?', [mae]);
    expect(fim?.['vigencia_fim']).not.toBeNull();
    expect(fim?.['excluido_em']).toBeNull();
    const lidos = await ficha.responsaveis(c(), menor);
    expect(lidos.pendencias).toEqual([{ pendencia: 'comprovante-ausente', vinculo: expect.any(Number) }]);
    expect(lidos.itens.find((x) => x.id === mae)?.vigente).toBe(false);
    // Curatela: o adulto incapaz não fica sem curador sem o levantamento declarado.
    const cur = await ficha.incluirResponsavel(
      c(),
      { ...base, paciente: adulto, cpf: CPF_TIO, nome: null, papel: 'curador', autorizarProcedimento: true },
      trilha('responsavel_paciente'),
    );
    expect(
      await codigo(
        ficha.encerrarResponsavel(
          c(),
          { paciente: adulto, id: cur, levantamentoCuratela: false, motivo: 'fim' },
          trilha('r'),
        ),
      ),
    ).toBe('incapaz-sem-curador');
    await ficha.encerrarResponsavel(
      c(),
      { paciente: adulto, id: cur, levantamentoCuratela: true, motivo: 'levantamento' },
      trilha('r'),
    );
    expect((await ficha.responsaveis(c(), adulto)).itens.find((x) => x.id === cur)?.vigente).toBe(false);
    // Representante sem data de nascimento: a maioridade não está provada.
    expect(
      await codigo(
        ficha.incluirResponsavel(
          c(),
          {
            ...base,
            paciente: adulto,
            cpf: CPF_SEM_DATA,
            nome: `SEM DATA FICHA ${MARCA}`,
            nascimento: null,
            papel: 'curador',
            autorizarProcedimento: true,
          },
          trilha('r'),
        ),
      ),
    ).toBe('responsavel-invalido');
    // Incluído e encerrado no mesmo dia; e o que só começa no futuro: os dois deixam de valer (intervalo vazio).
    const familiar = {
      ...base,
      paciente: adulto,
      cpf: CPF_PRIMO,
      nome: `PRIMO FICHA ${MARCA}`,
      papel: 'familiar' as const,
      autorizarProcedimento: false,
      receberInformacao: false,
      retirarDocumento: false,
    };
    const hoje = await ficha.incluirResponsavel(c(), { ...familiar, vigenciaInicio: null }, trilha('r'));
    const futuro = await ficha.incluirResponsavel(
      c(),
      { ...familiar, nome: null, papel: 'acompanhante', vigenciaInicio: '2099-01-01' },
      trilha('r'),
    );
    for (const id of [hoje, futuro])
      await ficha.encerrarResponsavel(
        c(),
        { paciente: adulto, id, levantamentoCuratela: false, motivo: 'fim' },
        trilha('r'),
      );
    const itens = (await ficha.responsaveis(c(), adulto)).itens;
    expect(itens.find((x) => x.id === hoje)?.vigente).toBe(false);
    expect(itens.find((x) => x.id === futuro)?.vigente).toBe(false);
    const vigentesHoje = await um<{ n: unknown }>(
      `SELECT COUNT(*) AS n FROM responsavel_paciente WHERE id IN (?, ?) AND vigencia_inicio <= CURRENT_DATE
         AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
      [hoje, futuro],
    );
    expect(Number(vigentesHoje?.n)).toBe(0);
    expect(
      await codigo(
        ficha.encerrarResponsavel(
          c(),
          { paciente: adulto, id: hoje, levantamentoCuratela: false, motivo: 'fim' },
          trilha('r'),
        ),
      ),
    ).toBe('vinculo-inexistente');
  });
});
