// Contrato de efeito da doação e do transplante de órgãos no prontuário (03-PEP L145), contra o MariaDB real (cliente
// de teste f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimentos c2110 e c2110b, logins c2110.*, órgão
// C2110_RIM, parentesco C2110_PAR, pacientes com prontuário 2110xxxxx), limpa antes e depois (a trilha pelo
// utilitário comum). Prova o que fica no banco: o doador em `doador_orgao` (uma doação em aberto, repetição pela mesma
// chave sem gravar de novo, passos da situação com a versão lida, captação só com autorização e morte encefálica,
// fechado_em no encerramento); os antibióticos numerados e o encerramento; o receptor em `receptor_transplante` (uma
// inscrição por órgão na lista, transplante só pelo destino, inaptidão com motivo e data); o destino em
// `doador_receptor` até o transplante, que muda o receptor junto; a solução de preservação com o profissional da
// sessão; o acompanhamento depois do transplante; a visão por paciente; outra unidade sem acesso; e as rotas com o
// vínculo assistencial. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import { TransplanteClinicoController } from './transplante-clinico.controller.js';
import { TransplanteClinicoPropria } from './transplante-clinico-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'c2110';
const M = 'C2110';
const AUTOR = `${P}.autor`;
const PRONT = [211_000_001, 211_000_002, 211_000_003];
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const horasAtras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe.skipIf(SEM_BANCO)('doação e transplante de órgãos (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: TransplanteClinicoPropria;
  const ids = {
    est: 0,
    estB: 0,
    autor: 0,
    medico: 0,
    doador: 0,
    receptor: 0,
    receptor2: 0,
    rim: 0,
    figado: 0,
    par: 0,
  };
  const st = {
    doador: 0,
    doadorV: 0,
    receptor: 0,
    receptorV: 0,
    receptor2: 0,
    destino: 0,
    destinoV: 0,
    destino2: 0,
    destino2V: 0,
  };

  const limpar = async (e: Escritor) => {
    const pac = `(SELECT id FROM paciente WHERE numero_prontuario IN (${PRONT.join(',')}))`;
    const rec = `(SELECT id FROM receptor_transplante WHERE paciente_id IN ${pac})`;
    const doa = `(SELECT id FROM doador_orgao WHERE paciente_id IN ${pac})`;
    await e.executar(`DELETE FROM acompanhamento_pos_transplante WHERE receptor_transplante_id IN ${rec}`);
    await e.executar(`DELETE FROM solucao_preservacao_orgao WHERE doador_orgao_id IN ${doa}`);
    await e.executar(`DELETE FROM doador_receptor WHERE doador_orgao_id IN ${doa}`);
    await e.executar(`DELETE FROM receptor_transplante WHERE paciente_id IN ${pac}`);
    await e.executar(`DELETE FROM doador_antibiotico WHERE doador_orgao_id IN ${doa}`);
    await e.executar(`DELETE FROM doador_orgao WHERE paciente_id IN ${pac}`);
    await e.executar(`DELETE FROM paciente WHERE numero_prontuario IN (${PRONT.join(',')})`);
    await e.executar('DELETE FROM orgao_transplante WHERE codigo LIKE ?', [`${M}%`]);
    await e.executar('DELETE FROM tipo_parentesco WHERE codigo = ?', [`${M}_PAR`]);
    const profs = '(SELECT id FROM profissional WHERE observacao = ?)';
    await e.executar(`DELETE FROM usuario_profissional WHERE profissional_id IN ${profs}`, [`massa ${P}`]);
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await limparTrilhaDaMassa(e, { codigos: [P, `${P}b`] });
    await e.executar('DELETE FROM usuario WHERE login = ?', [AUTOR]);
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `leitura-${P}` }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (hospital = P, chave = `${P}-${randomUUID()}`) => ({
    hospital,
    login: AUTOR,
    correlacao: `teste-${P}`,
    chaveIdempotencia: chave,
  });
  const contar = async (tabela: string, coluna: string, valor: number) =>
    Number(
      (await ler<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${coluna} = ?`, [valor]))[0]!.n,
    );
  const doadorBase = () => ({
    paciente: ids.doador,
    tipo: 'falecido' as const,
    causaMorte: 'Causa sintética',
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    porta = new TransplanteClinicoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const estab = async (codigo: string) => {
        const x = await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]);
        return x
          ? Number(x.id)
          : ins(
              'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
              [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
            );
      };
      ids.est = await estab(P);
      ids.estB = await estab(`${P}b`);
      ids.autor = await ins('INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)', [
        AUTOR,
        'Conta sintética',
        '21102110001',
        agora,
      ]);
      const pessoa = (sufixo: string) =>
        ins('INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)', [
          `Pessoa sintética ${P} ${sufixo}`,
          '1970-01-01',
          agora,
        ]);
      ids.medico = await ins(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
        [await pessoa('médica'), `massa ${P}`, agora],
      );
      await ins(
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.autor, ids.medico, '2026-01-01', agora],
      );
      const paciente = async (n: number, s: string) =>
        ins('INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)', [
          await pessoa(s),
          n,
          agora,
        ]);
      ids.doador = await paciente(PRONT[0]!, 'doador');
      ids.receptor = await paciente(PRONT[1]!, 'receptor');
      ids.receptor2 = await paciente(PRONT[2]!, 'receptor 2');
      const orgao = (cod: string, desc: string) =>
        ins("INSERT INTO orgao_transplante (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'orgao', ?)", [
          cod,
          desc,
          agora,
        ]);
      ids.rim = await orgao(`${M}_RIM`, 'Rim sintético');
      ids.figado = await orgao(`${M}_FIG`, 'Fígado sintético');
      ids.par = await ins('INSERT INTO tipo_parentesco (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
        `${M}_PAR`,
        'Parentesco sintético',
        agora,
      ]);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('doador: nasce em avaliação, uma doação em aberto, a repetição pela chave não grava de novo', async () => {
    const chave = `${P}-doador-${randomUUID()}`;
    await expect(porta.gravar('doador', ctx(), { ...doadorBase(), situacao: 'apto' })).rejects.toMatchObject(
      recusada('doacao-comeca-em-avaliacao'),
    );
    const r = await porta.gravar('doador', ctx(P, chave), doadorBase());
    const again = await porta.gravar('doador', ctx(P, chave), doadorBase());
    expect(again.repetida).toBe(true);
    st.doador = Number(r.resultado.id);
    st.doadorV = 1;
    expect(await contar('doador_orgao', 'paciente_id', ids.doador)).toBe(1);
    await expect(porta.gravar('doador', ctx(), doadorBase())).rejects.toMatchObject(
      recusada('doacao-em-aberto'),
    );
    const [d] = await ler(
      `SELECT estabelecimento_id, situacao, consentimento_familia, causa_morte, profissional_id, origem, criado_por,
              fechado_em FROM doador_orgao WHERE id = ?`,
      [st.doador],
    );
    expect(d).toMatchObject({
      situacao: 'em_avaliacao',
      consentimento_familia: 'pendente',
      causa_morte: 'Causa sintética',
      origem: 'sistema',
      fechado_em: null,
    });
    expect(Number(d!['estabelecimento_id'])).toBe(ids.est);
    expect(Number(d!['profissional_id'])).toBe(ids.medico);
    expect(Number(d!['criado_por'])).toBe(ids.autor);
    // Outra unidade não enxerga nem altera a doação.
    await expect(
      porta.gravar('doador', ctx(`${P}b`), { ...doadorBase(), id: st.doador, versao: 1 }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 404 }) });
    expect((await porta.doPaciente(ctx(`${P}b`), ids.doador)).doacoes).toHaveLength(0);
  });

  it('doador: passos da situação, autorização da família e morte encefálica com a versão lida', async () => {
    const alt = (campos: Record<string, unknown>) =>
      porta.gravar('doador', ctx(), { ...doadorBase(), id: st.doador, versao: st.doadorV, ...campos });
    await expect(alt({ situacao: 'captado', captacaoEm: horasAtras(2) })).rejects.toMatchObject(
      recusada('transicao-doador'),
    );
    await expect(alt({ consentimento: 'autorizado', consentimentoEm: horasAtras(8) })).rejects.toMatchObject(
      recusada('responsavel-consentimento'),
    );
    const familia = {
      consentimento: 'autorizado',
      consentimentoEm: horasAtras(8),
      responsavelConsentimento: 'Familiar sintético',
      parentesco: ids.par,
      morteEncefalicaEm: horasAtras(10),
      procedimentoInicioEm: horasAtras(3),
    };
    const r = await alt({ ...familia, situacao: 'apto' });
    st.doadorV = Number(r.resultado.versao);
    expect(st.doadorV).toBe(2);
    await expect(alt({ ...familia, situacao: 'apto', versao: 1 } as never)).rejects.toMatchObject({
      problema: expect.objectContaining({ status: 409 }),
    });
    const [d] = await ler(
      'SELECT situacao, consentimento_familia, tipo_parentesco_id, morte_encefalica_em, versao FROM doador_orgao WHERE id = ?',
      [st.doador],
    );
    expect(d).toMatchObject({ situacao: 'apto', consentimento_familia: 'autorizado' });
    expect(Number(d!['tipo_parentesco_id'])).toBe(ids.par);
    // Pendência: morte encefálica sem o número da central.
    const vis = await porta.doPaciente(ctx(), ids.doador);
    expect(vis.doacoes[0]!.pendencias.map((x) => x.codigo)).toEqual(['notificar-central']);
    Object.assign(familia, { registroCentral: 'CET-SINT-1' });
    const r2 = await alt({ ...familia, situacao: 'apto' });
    st.doadorV = Number(r2.resultado.versao);
    (globalThis as Record<string, unknown>)['c2110familia'] = familia;
  });

  it('antibióticos numerados; o encerramento só põe o fim', async () => {
    const a1 = await porta.gravar('antibiotico', ctx(), {
      doador: st.doador,
      descricao: 'Antibiótico A',
      inicio: '2026-11-20',
    });
    await porta.gravar('antibiotico', ctx(), {
      doador: st.doador,
      descricao: 'Antibiótico B',
      inicio: '2026-11-21',
    });
    await expect(
      porta.gravar('antibiotico', ctx(), { doador: st.doador, descricao: 'C', inicio: '2099-01-01' }),
    ).rejects.toMatchObject(recusada('antibiotico-futuro'));
    const id1 = Number(a1.resultado.id);
    await expect(
      porta.gravar('antibiotico', ctx(), { doador: st.doador, id: id1, versao: 1, fim: '2026-11-19' }),
    ).rejects.toMatchObject(recusada('antibiotico-periodo'));
    await porta.gravar('antibiotico', ctx(), { doador: st.doador, id: id1, versao: 1, fim: '2026-11-22' });
    await expect(
      porta.gravar('antibiotico', ctx(), { doador: st.doador, id: id1, versao: 2, fim: '2026-11-23' }),
    ).rejects.toMatchObject(recusada('antibiotico-encerrado'));
    const linhas = await ler(
      'SELECT sequencia, descricao, CAST(data_fim AS CHAR) AS fim, versao FROM doador_antibiotico WHERE doador_orgao_id = ? ORDER BY sequencia',
      [st.doador],
    );
    expect(
      linhas.map((x) => [Number(x['sequencia']), x['descricao'], x['fim'], Number(x['versao'])]),
    ).toEqual([
      [1, 'Antibiótico A', '2026-11-22', 2],
      [2, 'Antibiótico B', null, 1],
    ]);
  });

  it('receptor: uma inscrição por órgão na lista, transplante só pelo destino, inaptidão com motivo e data', async () => {
    const base = {
      paciente: ids.receptor,
      orgao: ids.rim,
      cadastradoEm: '2026-11-01',
      tipoDialise: 'hemodialise',
    };
    const r = await porta.gravar('receptor', ctx(), base);
    st.receptor = Number(r.resultado.id);
    st.receptorV = 1;
    await expect(
      porta.gravar('receptor', ctx(), { ...base, cadastradoEm: '2026-11-02' }),
    ).rejects.toMatchObject(recusada('inscricao-em-aberto'));
    await expect(
      porta.gravar('receptor', ctx(), { ...base, id: st.receptor, versao: 1, situacao: 'transplantado' }),
    ).rejects.toMatchObject(recusada('transplante-pelo-destino'));
    await expect(
      porta.gravar('receptor', ctx(), { ...base, id: st.receptor, versao: 1, apto: false }),
    ).rejects.toMatchObject(recusada('motivo-inaptidao'));
    const r2 = await porta.gravar('receptor', ctx(), {
      ...base,
      id: st.receptor,
      versao: 1,
      apto: false,
      motivoAptidao: 'Infecção sintética em tratamento',
      urgencia: true,
    });
    const r3 = await porta.gravar('receptor', ctx(), {
      ...base,
      id: st.receptor,
      versao: Number(r2.resultado.versao),
      apto: true,
      urgencia: true,
    });
    st.receptorV = Number(r3.resultado.versao);
    const [x] = await ler(
      `SELECT situacao, apto, urgencia, CAST(aptidao_alterada_em AS CHAR) AS alterada, tipo_dialise, estabelecimento_id
         FROM receptor_transplante WHERE id = ?`,
      [st.receptor],
    );
    expect(x).toMatchObject({ situacao: 'ativo', alterada: hoje(), tipo_dialise: 'hemodialise' });
    expect(Boolean(Number(x!['apto']))).toBe(true);
    expect(Boolean(Number(x!['urgencia']))).toBe(true);
    const r4 = await porta.gravar('receptor', ctx(), {
      paciente: ids.receptor2,
      orgao: ids.rim,
      cadastradoEm: '2026-11-10',
    });
    st.receptor2 = Number(r4.resultado.id);
    const lista = await porta.receptoresDoOrgao(ctx(), ids.rim);
    expect(lista.map((l) => l.id)).toEqual([st.receptor, st.receptor2]);
    expect(lista[0]).not.toHaveProperty('nome');
  });

  it('destino do órgão até o transplante, que muda o receptor junto; preservação e acompanhamento', async () => {
    await expect(
      porta.gravar('destino', ctx(), { doador: st.doador, receptor: st.receptor, orgao: ids.figado }),
    ).rejects.toMatchObject(recusada('orgao-diferente-da-inscricao'));
    await expect(
      porta.gravar('destino', ctx(), {
        doador: st.doador,
        receptor: st.receptor,
        orgao: ids.rim,
        doadorVivoParente: true,
        parentesco: ids.par,
      }),
    ).rejects.toMatchObject(recusada('parente-so-doador-vivo'));
    const d = await porta.gravar('destino', ctx(), {
      doador: st.doador,
      receptor: st.receptor,
      orgao: ids.rim,
    });
    st.destino = Number(d.resultado.id);
    await expect(
      porta.gravar('destino', ctx(), { doador: st.doador, receptor: st.receptor, orgao: ids.rim }),
    ).rejects.toMatchObject(recusada('destino-repetido'));
    await expect(
      porta.gravar('destino', ctx(), { id: st.destino, versao: 1, situacao: 'transplantado' }),
    ).rejects.toMatchObject(recusada('transicao-destino'));
    const ac = await porta.gravar('destino', ctx(), { id: st.destino, versao: 1, situacao: 'aceito' });
    st.destinoV = Number(ac.resultado.versao);
    await expect(
      porta.gravar('destino', ctx(), { id: st.destino, versao: st.destinoV, situacao: 'transplantado' }),
    ).rejects.toMatchObject(recusada('transplante-sem-captacao'));
    // Preservação: receptor sem destino recusado; com destino, linha numerada com o profissional da sessão.
    await expect(
      porta.gravar('preservacao', ctx(), {
        doador: st.doador,
        orgao: ids.rim,
        receptor: st.receptor2,
        nomeSolucao: 'Solução sintética',
        aplicadaEm: horasAtras(1),
      }),
    ).rejects.toMatchObject(recusada('receptor-sem-destino'));
    await porta.gravar('preservacao', ctx(), {
      doador: st.doador,
      orgao: ids.rim,
      receptor: st.receptor,
      nomeSolucao: 'Solução sintética',
      lote: 'L-SINT',
      validade: '2099-12-31',
      volumeMl: 1000,
      aplicadaEm: horasAtras(1),
    });
    const [pr] = await ler(
      'SELECT sequencia, responsavel_profissional_id, volume_ml FROM solucao_preservacao_orgao WHERE doador_orgao_id = ?',
      [st.doador],
    );
    expect(Number(pr!['sequencia'])).toBe(1);
    expect(Number(pr!['responsavel_profissional_id'])).toBe(ids.medico);
    // Captação: sem data recusada; com data, encerra a doação.
    const familia = (globalThis as Record<string, unknown>)['c2110familia'] as Record<string, unknown>;
    const cap = { ...doadorBase(), ...familia, id: st.doador, versao: st.doadorV, situacao: 'captado' };
    await expect(porta.gravar('doador', ctx(), cap)).rejects.toMatchObject(recusada('captacao-sem-data'));
    const c = await porta.gravar('doador', ctx(), { ...cap, captacaoEm: horasAtras(2) });
    st.doadorV = Number(c.resultado.versao);
    const [dd] = await ler('SELECT situacao, fechado_em FROM doador_orgao WHERE id = ?', [st.doador]);
    expect(dd!['situacao']).toBe('captado');
    expect(dd!['fechado_em']).not.toBeNull();
    await expect(
      porta.gravar('doador', ctx(), { ...cap, captacaoEm: horasAtras(2), versao: st.doadorV }),
    ).rejects.toMatchObject(recusada('doacao-encerrada'));
    // Acompanhamento antes do transplante: recusado.
    await expect(
      porta.gravar('acompanhamento', ctx(), {
        receptor: st.receptor,
        observadoEm: hoje(),
        descricao: 'Sintoma sintético',
      }),
    ).rejects.toMatchObject(recusada('receptor-sem-transplante'));
    await porta.gravar('destino', ctx(), { id: st.destino, versao: st.destinoV, situacao: 'transplantado' });
    const [rt] = await ler(
      `SELECT situacao, CAST(transplantado_em AS CHAR) AS em, doador_orgao_id, versao FROM receptor_transplante WHERE id = ?`,
      [st.receptor],
    );
    expect(rt).toMatchObject({ situacao: 'transplantado', em: hoje() });
    expect(Number(rt!['doador_orgao_id'])).toBe(st.doador);
    expect(Number(rt!['versao'])).toBe(st.receptorV + 1);
    const [dr] = await ler('SELECT situacao FROM doador_receptor WHERE id = ?', [st.destino]);
    expect(dr!['situacao']).toBe('transplantado');
    const a = await porta.gravar('acompanhamento', ctx(), {
      receptor: st.receptor,
      observadoEm: hoje(),
      tipo: 'suspeita_rejeicao',
      descricao: 'Achado sintético',
    });
    expect(Number(a.resultado.sequencia)).toBe(1);
    await expect(
      porta.gravar('acompanhamento', ctx(), {
        receptor: st.receptor,
        observadoEm: '2026-11-01',
        descricao: 'x',
      }),
    ).rejects.toMatchObject(recusada('antes-do-transplante'));
    const [ap] = await ler(
      'SELECT tipo, registrado_profissional_id, origem FROM acompanhamento_pos_transplante WHERE receptor_transplante_id = ?',
      [st.receptor],
    );
    expect(ap).toMatchObject({ tipo: 'suspeita_rejeicao', origem: 'sistema' });
    expect(Number(ap!['registrado_profissional_id'])).toBe(ids.medico);
  });

  it('o mesmo órgão do doador não é aceito em mais receptores que a quantidade do catálogo', async () => {
    // O rim do doador já foi transplantado no primeiro receptor; ofertar ao segundo é possível, aceitar não (1 por padrão).
    const o = await porta.gravar('destino', ctx(), {
      doador: st.doador,
      receptor: st.receptor2,
      orgao: ids.rim,
    });
    st.destino2 = Number(o.resultado.id);
    await expect(
      porta.gravar('destino', ctx(), { id: st.destino2, versao: 1, situacao: 'aceito' }),
    ).rejects.toMatchObject(recusada('orgao-ja-destinado'));
    const [antes] = await ler('SELECT situacao, versao FROM doador_receptor WHERE id = ?', [st.destino2]);
    expect(antes).toMatchObject({ situacao: 'ofertado' });
    expect(Number(antes!['versao'])).toBe(1);
    // Rim é par: com a quantidade 2 no catálogo, o segundo receptor aceita.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `ajuste-${P}` }, (e) =>
      e.executar('UPDATE orgao_transplante SET quantidade_por_doador = 2 WHERE id = ?', [ids.rim]),
    );
    expect((await porta.opcoes()).orgaos.find((x) => x.id === ids.rim)?.quantidadePorDoador).toBe(2);
    const ac = await porta.gravar('destino', ctx(), { id: st.destino2, versao: 1, situacao: 'aceito' });
    st.destino2V = Number(ac.resultado.versao);
    const [depois] = await ler('SELECT situacao FROM doador_receptor WHERE id = ?', [st.destino2]);
    expect(depois).toMatchObject({ situacao: 'aceito' });
  });

  it('visão por paciente: doação completa e inscrição com o acompanhamento', async () => {
    const doador = await porta.doPaciente(ctx(), ids.doador);
    expect(doador.inscricoes).toHaveLength(0);
    const d = doador.doacoes[0]!;
    expect(d).toMatchObject({
      situacao: 'captado',
      encerrada: true,
      registroCentral: 'CET-SINT-1',
      pendencias: [],
    });
    expect(d.antibioticos).toHaveLength(2);
    expect(d.preservacoes[0]).toMatchObject({ sequencia: 1, receptor: st.receptor, volumeMl: 1000 });
    expect(d.destinos[0]).toMatchObject({
      situacao: 'transplantado',
      receptor: st.receptor,
      prontuarioReceptor: String(PRONT[1]),
    });
    const rec = await porta.doPaciente(ctx(), ids.receptor);
    const i = rec.inscricoes[0]!;
    expect(i).toMatchObject({
      situacao: 'transplantado',
      naLista: false,
      doador: st.doador,
      transplantadoEm: hoje(),
    });
    expect(i.acompanhamentos[0]).toMatchObject({ dias: 0, destaque: true, tipo: 'suspeita_rejeicao' });
    expect(i.destinos[0]!.prontuarioDoador).toBe(String(PRONT[0]));
    expect((await porta.receptoresDoOrgao(ctx(), ids.rim)).map((x) => x.id)).toEqual([st.receptor2]);
  });

  it('as rotas exigem o vínculo assistencial com o paciente e a leitura vai à trilha', async () => {
    const PERMS = ['pep.prontuario.ler', 'pep.evolucao.criar'];
    const montar = (pacientes: readonly number[]) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new TransplanteClinicoController(
        new EstadoProntuario(),
        trilha,
        porta,
        null,
        null,
        new VinculoSintetico(
          pacientes.map((idPaciente) => ({
            login: AUTOR,
            idPaciente,
            forma: 'atendimento-em-curso' as const,
          })),
        ),
        null,
      );
      const req = () =>
        ({
          headers: { 'idempotency-key': `${P}-ctrl-${randomUUID()}`, 'x-correlation-id': `${P}-ctrl` },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...PERMS], null)),
            sessao: {
              usuario: { id: String(ids.autor), nome: 'Conta sintética', login: AUTOR },
              rede: `rede-${P}`,
              estabelecimentos: [],
              estabelecimentoAtivo: P,
              unidadeAtiva: null,
              permissoes: [...PERMS],
              restricaoVinculo: true,
              sintetica: true,
              bloqueioInatividadeSegundos: 0,
              expiraEm: '',
            },
          },
        }) as unknown as RequisicaoAutorizada;
      return { trilha, ctrl, req };
    };
    const antes = await contar('receptor_transplante', 'paciente_id', ids.receptor2);
    const sem = montar([]);
    await expect(sem.ctrl.doPaciente(ids.receptor2, sem.req())).rejects.toMatchObject({ status: 403 });
    expect(
      sem.trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === ids.receptor2,
      ),
    ).toBe(true);
    await expect(
      sem.ctrl.receptor(
        { paciente: ids.receptor2, orgao: ids.figado, cadastradoEm: '2026-11-10' },
        sem.req(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      sem.ctrl.acompanhamento({ receptor: 999_999_999, observadoEm: hoje(), descricao: 'x' }, sem.req()),
    ).rejects.toMatchObject({ status: 404 });
    expect(await contar('receptor_transplante', 'paciente_id', ids.receptor2)).toBe(antes);
    const com = montar([ids.receptor2]);
    const tela = await com.ctrl.doPaciente(ids.receptor2, com.req());
    expect(tela.inscricoes).toHaveLength(1);
    expect(com.trilha.eventos.some((e) => e.paciente === ids.receptor2)).toBe(true);
    const r = await com.ctrl.receptor(
      { paciente: ids.receptor2, orgao: ids.figado, cadastradoEm: '2026-11-10' },
      com.req(),
    );
    expect(r).toMatchObject({ ok: true, mensagem: 'Receptor gravado.' });
    expect(await contar('receptor_transplante', 'paciente_id', ids.receptor2)).toBe(antes + 1);
    const op = await com.ctrl.opcoes();
    expect(op.orgaos.some((o) => o.id === ids.rim)).toBe(true);
    expect(op.parentescos.some((o) => o.id === ids.par)).toBe(true);

    // Destino: o vínculo só com o doador não muda o destino nem a inscrição do receptor (403, nada grava).
    const soDoador = montar([ids.doador]);
    const destinosAntes = await contar('doador_receptor', 'doador_orgao_id', st.doador);
    await expect(
      soDoador.ctrl.destino({ id: st.destino2, versao: st.destino2V, situacao: 'recusado' }, soDoador.req()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      soDoador.ctrl.destino({ doador: st.doador, receptor: st.receptor2, orgao: ids.figado }, soDoador.req()),
    ).rejects.toMatchObject({ status: 403 });
    const [dr2] = await ler('SELECT situacao, versao FROM doador_receptor WHERE id = ?', [st.destino2]);
    expect(dr2).toMatchObject({ situacao: 'aceito' });
    expect(Number(dr2!['versao'])).toBe(st.destino2V);
    expect(await contar('doador_receptor', 'doador_orgao_id', st.doador)).toBe(destinosAntes);
    expect(
      soDoador.trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === ids.receptor2,
      ),
    ).toBe(true);
    // Com vínculo com os dois, o destino grava.
    const ambos = montar([ids.doador, ids.receptor2]);
    const rec = await ambos.ctrl.destino(
      { id: st.destino2, versao: st.destino2V, situacao: 'recusado' },
      ambos.req(),
    );
    expect(rec).toMatchObject({ ok: true, mensagem: 'Destino do órgão gravado.' });
    const [dr3] = await ler('SELECT situacao FROM doador_receptor WHERE id = ?', [st.destino2]);
    expect(dr3).toMatchObject({ situacao: 'recusado' });

    // Lista de receptores do órgão: só a partir de uma doação com vínculo com o doador; a consulta vai à trilha.
    await expect(sem.ctrl.receptores(ids.rim, st.doador, sem.req())).rejects.toMatchObject({ status: 403 });
    await expect(soDoador.ctrl.receptores(ids.rim, 999_999_999, soDoador.req())).rejects.toMatchObject({
      status: 404,
    });
    const leiturasAntes = soDoador.trilha.eventos.filter((e) => e.paciente === ids.doador).length;
    const lista = await soDoador.ctrl.receptores(ids.rim, st.doador, soDoador.req());
    expect(lista.map((x) => x.id)).toEqual([st.receptor2]);
    expect(soDoador.trilha.eventos.filter((e) => e.paciente === ids.doador).length).toBeGreaterThan(
      leiturasAntes,
    );
  });
});
