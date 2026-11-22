// Integração da porta PRÓPRIA do cadastro contra o MariaDB real (cliente f22_o1 da onda 1, criado pelo orquestrador).
// Contrato de efeito de cada gravação: linhas, versao, trilha_auditoria e saída (integracao_mensagem) na mesma
// transação; recusas (CPF repetido, CEP inexistente, conflito de versão, unificação inválida, solicitante repetido).
// Massa SINTÉTICA (massa.spec-util.ts), limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe.skipIf(SEM_BANCO)('porta própria do cadastro contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCadastroPropria;
  let m: Massa | null = null;
  const cpfUm = cpfSintetico('990102001');
  const cpfDois = cpfSintetico('990102002');

  const contar = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-conta' }, async (l) =>
      Number((await l.uma<{ n: unknown }>(sql, p))?.n ?? 0),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    porta = new PortaCadastroPropria(nucleo, CLIENTE_F22);
  });

  afterAll(async () => {
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  const novoPaciente = (cpf: string, nome: string) => ({
    nome,
    nascimento: '1980-05-17',
    sexo: 'F' as const,
    cpf,
    nomeMae: `MAE ${MARCA}`,
    naturalidade: 'BELO HORIZONTE',
    ufNaturalidade: 'MG',
    cep: CEP_TESTE,
    numero: 100,
    celular: '31999990102',
    contatoNome: `CONTATO ${MARCA}`,
    contatoTelefone: '3133330102',
  });

  let idUm = 0;

  it('cadastra o paciente: pessoa, papel de paciente, endereço, telefones, retrato, trilha e saída na mesma transação', async () => {
    const mm = m!;
    const ctx = contextoGravacao(mm);
    const r = await porta.cadastrar(contextoPorta(mm), novoPaciente(cpfUm, `PACIENTE UM ${MARCA}`), ctx);
    idUm = r.resultado.idPaciente;
    expect(idUm).toBeGreaterThan(0);
    expect(r.resultado.prontuario).toBeGreaterThanOrEqual(900000);
    expect(r.trilha).toBeGreaterThan(0);
    const [p] = await porta.lerPacientes(contextoPorta(mm), [idUm]);
    expect(p).toMatchObject({
      nome: `PACIENTE UM ${MARCA}`,
      cpf: cpfUm,
      nascimento: '1980-05-17',
      sexo: 'F',
      cep: CEP_TESTE,
      cidade: 'BELO HORIZONTE',
      uf: 'MG',
      celular: '31999990102',
      contatoNome: `CONTATO ${MARCA}`,
      ativo: true,
      versao: 'v1',
    });
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM telefone_pessoa t JOIN paciente p ON p.pessoa_fisica_id = t.pessoa_fisica_id WHERE p.id = ?',
        [idUm],
      ),
    ).toBe(2);
    expect(await contar('SELECT COUNT(*) AS n FROM paciente_versao WHERE paciente_id = ?', [idUm])).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE id = ? AND entidade = 'paciente' AND entidade_id = ? AND acao = 'inclusao'",
        [r.trilha, idUm],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'cadastro.paciente.incluido' AND entidade_id = ?",
        [idUm],
      ),
    ).toBe(1);
    // A mesma Idempotency-Key repete o resultado sem gravar de novo.
    const rep = await porta.cadastrar(contextoPorta(mm), novoPaciente(cpfUm, `PACIENTE UM ${MARCA}`), ctx);
    expect(rep.resultado.idPaciente).toBe(idUm);
    expect(await contar('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [cpfUm])).toBe(1);
  });

  it('recusa CPF já cadastrado e CEP fora da base postal (nada gravado)', async () => {
    const mm = m!;
    await expect(
      porta.cadastrar(contextoPorta(mm), novoPaciente(cpfUm, `OUTRO ${MARCA}`), contextoGravacao(mm)),
    ).rejects.toMatchObject({ problema: { codigo: 'cpf-existente', status: 409 } });
    await expect(
      porta.cadastrar(
        contextoPorta(mm),
        { ...novoPaciente(cpfDois, `SEM CEP ${MARCA}`), cep: '00000001' },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'cep-inexistente', campos: ['cep'] } });
    expect(await contar('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [cpfDois])).toBe(0);
  });

  it('encontra pelo CPF, pelo prontuário e pelas palavras do nome (sem acento nem maiúscula)', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const porCpf = await porta.buscarDireto(c, { tipo: 'cpf', cpf: Number(cpfUm) }, false);
    expect(porCpf.pacientes.map((x) => x.id)).toEqual([idUm]);
    const [p] = await porta.lerPacientes(c, [idUm]);
    const porPront = await porta.buscarDireto(c, { tipo: 'prontuario', prontuario: p!.prontuario }, false);
    expect(porPront.pacientes[0]?.id).toBe(idUm);
    const ids = await porta.idsPorPalavras(
      c,
      'paciente',
      ['nome', 'social'],
      ['paciente', MARCA.toLowerCase()],
      50,
    );
    expect(ids.ids).toContain(idUm);
    expect((await porta.lerCep(c, CEP_TESTE))?.cidade).toBe('BELO HORIZONTE');
    expect(await porta.cepExiste(c, '00000001')).toBe(false);
  });

  it('altera com a versão lida: sobe a versão, grava o retrato e a trilha; versão velha é conflito (409)', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const r = await porta.alterar(
      c,
      {
        idPaciente: idUm,
        versao: 'v1',
        alteracoes: { complemento: 'APTO 2', email: 'teste@exemplo.invalid' },
      },
      contextoGravacao(mm),
    );
    expect(r.resultado.idPaciente).toBe(idUm);
    const [p] = await porta.lerPacientes(c, [idUm]);
    expect(p).toMatchObject({ complemento: 'APTO 2', email: 'teste@exemplo.invalid', versao: 'v2' });
    expect(await contar('SELECT COUNT(*) AS n FROM paciente_versao WHERE paciente_id = ?', [idUm])).toBe(2);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'paciente' AND entidade_id = ? AND acao = 'alteracao'",
        [idUm],
      ),
    ).toBe(1);
    await expect(
      porta.alterar(
        c,
        { idPaciente: idUm, versao: 'v1', alteracoes: { complemento: 'APTO 3' } },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao', status: 409 } });
    await expect(
      porta.alterar(
        c,
        { idPaciente: idUm, versao: 'v2', alteracoes: { complemento: 'APTO 2' } },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'sem-alteracao' } });
    const h = await porta.historico(c, idUm, 1, 10);
    expect(h.total).toBe(2);
    expect(h.versoes[0]?.valores['complemento']).toBe('APTO 2');
    expect(h.versoes[0]?.usuario).toBe(mm.login);
  });

  it('fila de duplicidades: homônimos viram par, "é outra pessoa" decide; unificação marca o absorvido e registra', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const dois = await porta.cadastrar(
      c,
      novoPaciente(cpfDois, `PACIENTE UM ${MARCA}`),
      contextoGravacao(mm),
    );
    const idDois = dois.resultado.idPaciente;
    expect(await porta.homonimos(c, [idUm, idDois])).toEqual(new Set([idUm, idDois]));
    const grupos = await porta.gruposCandidatos(c);
    expect(grupos.fonetica.some((g) => g.includes(idUm) && g.includes(idDois))).toBe(true);
    const trilha = {
      estabelecimento: mm.estabelecimento,
      usuario: mm.usuario,
      acao: 'operacao' as const,
      entidade: 'suspeita_duplicidade',
      entidadeId: null,
      dadosDepois: { evento: 'teste' },
      correlacao: 'f22-0102-fila',
    };
    const n = await porta.gravarPares(
      c,
      [{ a: { id: idUm, pront: 1 }, b: { id: idDois, pront: 2 }, escore: 80, criterios: ['nascimento'] }],
      [],
      trilha,
    );
    expect(n).toBe(1);
    expect(
      await porta.gravarPares(
        c,
        [{ a: { id: idDois, pront: 2 }, b: { id: idUm, pront: 1 }, escore: 80, criterios: ['nascimento'] }],
        [],
        trilha,
      ),
    ).toBe(0);
    // Registros dependentes do absorvido: alergia, convênio do paciente e atendimento (têm de passar ao que fica).
    const dep = await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-dep' }, async (w) => {
      const agora = new Date();
      const alergia = await w.inserir(
        "INSERT INTO alergia_paciente (estabelecimento_id, paciente_id, tipo_registro, registrado_em, criado_em) VALUES (?, ?, 'nega_alergias', ?, ?)",
        [mm.estabelecimento, idDois, agora, agora],
      );
      const cobertura = await w.inserir(
        'INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [idDois, mm.fonte, '0102-ABS', '2026-01-01', agora],
      );
      const cat = await w.uma<{ id: unknown }>(
        "SELECT id FROM categoria_atendimento WHERE codigo = 'consulta'",
        [],
      );
      const car = await w.uma<{ id: unknown }>(
        "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = '1'",
        [],
      );
      const atendimento = await w.inserir(
        "INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)",
        [
          mm.estabelecimento,
          `UNIF-${Date.now() % 1_000_000}`,
          idDois,
          Number(cat?.id),
          Number(car?.id),
          mm.fonte,
          mm.profissional,
          agora,
          agora,
        ],
      );
      return { alergia, cobertura, atendimento };
    });
    const fila = await porta.lerFila(c, 'aberto', 1, 50);
    const par = fila.itens.find((x) => x.a === Math.min(idUm, idDois));
    expect(par).toMatchObject({ situacao: 'aberto', criterios: ['nascimento'] });
    const unif = await porta.unificar(
      c,
      {
        idAbsorvido: idDois,
        idSobrevivente: idUm,
        par: par!.id,
        justificativa: 'Cadastro duplicado de teste',
      },
      contextoGravacao(mm),
    );
    expect(unif.resultado).toEqual({ idAbsorvido: idDois, idSobrevivente: idUm });
    for (const [t, id] of [
      ['alergia_paciente', dep.alergia],
      ['cobertura_paciente', dep.cobertura],
      ['atendimento', dep.atendimento],
    ] as const)
      expect(
        await contar(
          `SELECT COUNT(*) AS n FROM ${t} WHERE id = ? AND paciente_id = ? AND versao = 2 AND alterado_por = ?`,
          [id, idUm, mm.usuario],
        ),
      ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM unificacao_cadastro_item i JOIN unificacao_cadastro u ON u.id = i.unificacao_cadastro_id WHERE u.absorvido_paciente_id = ? AND i.tabela IN ('alergia_paciente', 'cobertura_paciente', 'atendimento') AND i.coluna = 'paciente_id'",
        [idDois],
      ),
    ).toBe(3);
    expect(
      await contar(
        'SELECT quantidade_registros AS n FROM unificacao_cadastro WHERE absorvido_paciente_id = ?',
        [idDois],
      ),
    ).toBe(3);
    const [abs] = await porta.lerPacientes(c, [idDois]);
    expect(abs).toMatchObject({ ativo: false, unificadoEm: idUm });
    expect(await porta.unificacoes(c, idUm)).toEqual([
      expect.objectContaining({ absorvido: idDois, sobrevivente: idUm }),
    ]);
    expect((await porta.lerPar(c, par!.id))?.situacao).toBe('unificado_no_legado');
    await expect(
      porta.unificar(c, { idAbsorvido: idDois, idSobrevivente: idUm }, contextoGravacao(mm)),
    ).rejects.toMatchObject({ problema: { codigo: 'ja-unificado' } });
    await expect(
      porta.alterar(
        c,
        { idPaciente: idDois, versao: abs!.versao, alteracoes: { complemento: 'X' } },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'cadastro-inativo' } });
  });

  it('e-mail de volta a um valor já usado (A→B→A) reativa a linha; o mesmo e-mail não muda nada', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const v = async () => (await porta.lerPacientes(c, [idUm]))[0]!.versao;
    await porta.alterar(
      c,
      { idPaciente: idUm, versao: await v(), alteracoes: { email: 'outro@exemplo.invalid' } },
      contextoGravacao(mm),
    );
    await porta.alterar(
      c,
      { idPaciente: idUm, versao: await v(), alteracoes: { email: 'teste@exemplo.invalid' } },
      contextoGravacao(mm),
    );
    const [p] = await porta.lerPacientes(c, [idUm]);
    expect(p?.email).toBe('teste@exemplo.invalid');
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM email_pessoa e JOIN paciente p ON p.pessoa_fisica_id = e.pessoa_fisica_id WHERE p.id = ?',
        [idUm],
      ),
    ).toBe(2);
    await expect(
      porta.alterar(
        c,
        { idPaciente: idUm, versao: p!.versao, alteracoes: { email: 'teste@exemplo.invalid' } },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'sem-alteracao' } });
  });

  it('a pessoa já cadastrada como profissional ganha só o papel de paciente (sem duplicar a pessoa)', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const cpf = cpfSintetico('990102003');
    const nome = `PROFISSIONAL PACIENTE ${MARCA}`;
    const pessoa = await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-prof' }, async (w) => {
      const id = await w.inserir(
        'INSERT INTO pessoa_fisica (nome, cpf, data_nascimento, criado_em) VALUES (?, ?, ?, ?)',
        [nome, cpf, '1980-05-17', new Date()],
      );
      await w.inserir(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [id, new Date()],
      );
      return id;
    });
    try {
      await expect(
        porta.cadastrar(c, novoPaciente(cpf, `OUTRO NOME ${MARCA}`), contextoGravacao(mm)),
      ).rejects.toMatchObject({ problema: { codigo: 'cpf-de-outra-pessoa' } });
      const r = await porta.cadastrar(c, novoPaciente(cpf, nome), contextoGravacao(mm));
      expect(
        await contar('SELECT COUNT(*) AS n FROM paciente WHERE id = ? AND pessoa_fisica_id = ?', [
          r.resultado.idPaciente,
          pessoa,
        ]),
      ).toBe(1);
      expect(await contar('SELECT COUNT(*) AS n FROM pessoa_fisica WHERE cpf = ?', [cpf])).toBe(1);
      await expect(porta.cadastrar(c, novoPaciente(cpf, nome), contextoGravacao(mm))).rejects.toMatchObject({
        problema: { codigo: 'cpf-existente' },
      });
    } finally {
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-prof' }, (w) =>
        w.executar('DELETE FROM profissional WHERE pessoa_fisica_id = ?', [pessoa]),
      );
    }
  });

  it('solicitante externo: inclui pelo conselho, UF e número; o repetido é recusado; lê pelo registro', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const r = await porta.cadastrarSolicitante(
      c,
      { nome: `SOLICITANTE ${MARCA}`, conselho: mm.conselho, uf: 'MG', numero: 7_010_102 },
      contextoGravacao(mm),
    );
    expect(r.resultado.solicitante).toBeGreaterThan(0);
    await expect(
      porta.cadastrarSolicitante(
        c,
        { nome: `SOLICITANTE DOIS ${MARCA}`, conselho: mm.conselho, uf: 'MG', numero: 7_010_102 },
        contextoGravacao(mm),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'solicitante-existente' } });
    const lidos = await porta.solicitantesPorRegistro(c, { numero: 7_010_102, conselho: 'CRM', uf: 'MG' });
    expect(lidos.itens).toEqual([
      expect.objectContaining({ nome: `SOLICITANTE ${MARCA}`, conselho: 'CRM', numero: 7_010_102, uf: 'MG' }),
    ]);
    expect(await porta.conselhoPorSigla(c, 'crm')).toBe(mm.conselho);
  });

  it('profissional: lista com o registro no conselho, ficha com o login vinculado e o profissional da sessão', async () => {
    const mm = m!;
    const c = contextoPorta(mm);
    const [p] = await porta.listarProfissionais(c, [mm.profissional]);
    expect(p).toMatchObject({
      nome: `MEDICA ${MARCA}`,
      registros: [expect.objectContaining({ conselho: 'CRM', numero: 990102, uf: 'MG', ativo: true })],
    });
    const f = await porta.fichaProfissional(c, mm.profissional);
    expect(f?.logins).toEqual([{ login: mm.login, origem: 'papel' }]);
    expect(await porta.dadosProfissional(c, mm.profissional)).toMatchObject({ versao: 'v1' });
  });

  it('os recursos ainda sem modelo respondem 501 (nada lido nem gravado)', async () => {
    await expect(porta.consentimentos()).rejects.toMatchObject({ status: 501 });
    await expect(porta.procedimentosDaEspecialidade()).rejects.toMatchObject({ status: 501 });
  });
});
