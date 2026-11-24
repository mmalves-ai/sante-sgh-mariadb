// Integração das alergias no banco próprio contra o MariaDB real (cliente de teste f22_o5). Massa SINTÉTICA do lote
// l0199a, montada no beforeAll e apagada no afterAll (só linhas do lote; o estabelecimento principal fica, como nas
// demais integrações do PEP); nenhum dado de pessoa real. Prova (segurança do paciente): a alergia de descrição livre
// e a sem registro clínico aparecem na leitura dos documentos e alertam na prescrição (pelo princípio registrado nela
// ou pelo nome do princípio, sem diferença de maiúsculas e acentos); o rascunho, a declaração "nega alergias" e a
// excluída ficam fora; a versão dos documentos é a das ativas do estabelecimento; a prescrição vê o cliente inteiro.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { achados, type ContextoAlertas, type ItemAvaliado } from '@sgh/dominio-pep';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alergias,
  alergiasDaPrescricao,
  catalogoAlergias,
  registrosParaAlergia,
  versaoAlergias,
} from './alergias-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_ALERGIAS']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l0199a';
const M = P.toUpperCase();
const C = { rede: CLIENTE, hospital: P, cliente: CLIENTE, estabelecimento: null, usuario: null, correlacao: P };
const PRONTUARIO = 901_990_101;
const CBO_MEDICO = '225125';

interface Massa {
  paciente: number;
  atendimento: number;
  inscricao: number;
  registro: number;
  registroSuspenso: number;
  registroDeOutro: number;
  principio: { penicilina: number; dipirona: number; tartrazina: number };
  alergia: {
    catalogo: number;
    livreSemRegistro: number;
    livreComPrincipio: number;
    inativa: number;
    rascunho: number;
    nega: number;
    excluida: number;
    outroEstabelecimento: number;
  };
}

describe.skipIf(SEM_BANCO)('alergias no banco próprio contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let m: Massa;

  async function limpar(e: Escritor): Promise<void> {
    const pac = '(SELECT id FROM paciente WHERE numero_prontuario = ?)';
    await e.executar(
      `DELETE FROM alergia_paciente_principio WHERE alergia_paciente_id IN (SELECT id FROM alergia_paciente WHERE paciente_id IN ${pac})`,
      [PRONTUARIO],
    );
    await e.executar(`DELETE FROM alergia_paciente WHERE paciente_id IN ${pac}`, [PRONTUARIO]);
    await e.executar('DELETE FROM principio_ativo_cliente WHERE nome LIKE ?', [`%${P}`]);
    await e.executar(
      'DELETE FROM alergeno_principio_ativo WHERE alergeno_id IN (SELECT id FROM alergeno WHERE codigo LIKE ?)',
      [`${M}%`],
    );
    await e.executar('DELETE FROM alergeno WHERE codigo LIKE ?', [`${M}%`]);
    await e.executar('DELETE FROM principio_ativo WHERE codigo_dcb LIKE ?', [`${M}%`]);
    const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
    const ests = [P, `${P}b`];
    await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, ests);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, ests);
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${M}_%`]);
    await e.executar('DELETE FROM tipo_documento_clinico WHERE codigo LIKE ?', [`${M}_%`]);
    await e.executar(`DELETE FROM paciente WHERE numero_prontuario = ?`, [PRONTUARIO]);
    const profs = '(SELECT id FROM profissional WHERE observacao = ?)';
    await e.executar(`DELETE FROM inscricao_conselho WHERE profissional_id IN ${profs}`, [`massa ${P}`]);
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await e.executar('DELETE FROM categoria_atendimento WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM usuario WHERE login = ?', [`${P}.autor`]);
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [`${P}b`]);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const achar = async (sql: string, p: unknown[], criar: () => Promise<number>) => {
        const x = await e.uma<{ id: unknown }>(sql, p);
        return x ? Number(x.id) : criar();
      };
      const estabelecimento = await achar('SELECT id FROM estabelecimento WHERE codigo = ?', [P], () =>
        ins('INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)', [
          P,
          `Hospital sintético ${P}`,
          `Hospital sintético ${P} (fictício)`,
          agora,
        ]),
      );
      await e.executar('UPDATE estabelecimento SET fuso_horario = ? WHERE id = ?', [
        'America/Sao_Paulo',
        estabelecimento,
      ]);
      const outroEst = await ins(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}b`, `Hospital sintético ${P}b`, `Hospital sintético ${P}b (fictício)`, agora],
      );
      const usuario = await ins('INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, ?, ?)', [
        `${P}.autor`,
        'Conta sintética autora',
        'servico',
        agora,
      ]);
      const tipo = await ins(
        'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${M}_EVOL`, 'Evolução sintética', 'evolucao', agora],
      );
      const modelo = await ins(
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        [`${M}_EVO`, 'Evolução sintética', tipo, agora],
      );
      const pessoa = (sufixo: string) =>
        ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`Pessoa sintética ${P} ${sufixo}`, agora]);
      const paciente = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [await pessoa('paciente'), PRONTUARIO, agora],
      );
      const profissional = async (sufixo: string) =>
        ins(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
          [await pessoa(sufixo), `massa ${P}`, agora],
        );
      const medico = await profissional('médica');
      const outroMedico = await profissional('outro médico');
      const ocupacao = await achar('SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?', [CBO_MEDICO], () =>
        ins('INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES (?, ?, TRUE, ?)', [
          CBO_MEDICO,
          'Ocupação médico (sintética)',
          agora,
        ]),
      );
      const conselho = await achar(
        'SELECT id FROM conselho_classe WHERE sigla = ? OR codigo_tiss = ? ORDER BY (sigla = ?) DESC LIMIT 1',
        ['LZALG', 'Z9', 'LZALG'],
        () =>
          ins('INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)', [
            'Z9',
            'LZALG',
            `Conselho sintético do lote ${P}`,
            agora,
          ]),
      );
      const pais = await achar("SELECT id FROM pais_referencia WHERE codigo_iso = 'BR'", [], () =>
        ins("INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES ('BR', 'Brasil', ?)", [agora]),
      );
      const uf = await achar("SELECT id FROM unidade_federativa WHERE sigla = 'RJ'", [], () =>
        ins(
          "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES ('33', 'RJ', 'Rio de Janeiro', ?, ?)",
          [pais, agora],
        ),
      );
      const inscricao = (prof: number, numero: string) =>
        ins(
          `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
             numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, ?, ?, TRUE, ?)`,
          [prof, conselho, uf, numero, ocupacao, agora],
        );
      const inscricaoMedico = await inscricao(medico, '199001');
      await inscricao(outroMedico, '199002');
      const categoria = await ins(
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [`${P}int`, 'Categoria sintética', agora],
      );
      const carater = await ins(
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await ins(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      const atendimento = (est: number, numero: string) =>
        ins(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
          [est, numero, paciente, categoria, carater, fonte, medico, new Date('2026-11-01T10:00:00Z'), agora],
        );
      const atend = await atendimento(estabelecimento, '9901');
      const atendOutro = await atendimento(outroEst, '9902');
      const registro = (autor: number, clinica: string, suspenso = false) =>
        ins(
          `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
             tipo_documento_clinico_id, autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento,
             impressao_digital, situacao, suspenso_em, suspenso_por_usuario_id, justificativa_suspensao, criado_em,
             ocupacao_cbo_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            estabelecimento,
            paciente,
            atend,
            modelo,
            tipo,
            autor,
            usuario,
            new Date(clinica),
            new Date(clinica),
            '0'.repeat(64),
            suspenso ? 'suspenso' : 'finalizado',
            suspenso ? agora : null,
            suspenso ? usuario : null,
            suspenso ? `Lançado no paciente errado ${P}` : null,
            agora,
            ocupacao,
          ],
        );
      const reg = await registro(medico, '2026-11-20T12:30:00Z');
      const regSuspenso = await registro(medico, '2026-11-21T12:30:00Z', true);
      const regOutro = await registro(outroMedico, '2026-11-22T12:30:00Z');

      const principio = (codigo: string, nome: string) =>
        ins('INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)', [
          `${M}${codigo}`,
          nome,
          'teste',
          agora,
        ]);
      const penicilina = await principio('1', `Benzilpenicilina sintética ${P}`);
      const dipirona = await principio('2', `Dipirona sintetica ${P}`);
      const tartrazina = await principio('3', `Tartrazina sintética ${P}`);
      const tartrazinaCliente = await ins(
        'INSERT INTO principio_ativo_cliente (nome, principio_ativo_id, criado_em) VALUES (?, ?, ?)',
        [`Tartrazina do hospital ${P}`, tartrazina, agora],
      );
      const alergeno = await ins(
        'INSERT INTO alergeno (codigo, descricao, natureza, criado_em) VALUES (?, ?, ?, ?)',
        [`${M}PEN`, `Penicilina sintética ${P}`, 'medicamento', agora],
      );
      await ins('INSERT INTO alergeno_principio_ativo (alergeno_id, principio_ativo_id, criado_em) VALUES (?, ?, ?)', [
        alergeno,
        penicilina,
        agora,
      ]);
      const alergia = (o: {
        est?: number;
        tipo?: string;
        situacao?: string;
        alergeno?: number | null;
        livre?: string | null;
        registro?: number | null;
        ativa?: boolean;
        excluida?: boolean;
      }) =>
        ins(
          `INSERT INTO alergia_paciente (estabelecimento_id, paciente_id, atendimento_id, tipo_registro, situacao_registro,
             alergeno_id, descricao_livre, registro_assistencial_id, registrado_em, registrado_profissional_id, ativa,
             inativado_em, motivo_inativacao, criado_em, excluido_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            o.est ?? estabelecimento,
            paciente,
            (o.est ?? estabelecimento) === estabelecimento ? atend : atendOutro,
            o.tipo ?? 'alergia',
            o.situacao ?? 'confirmado',
            o.alergeno ?? null,
            o.livre ?? null,
            o.registro ?? null,
            new Date('2026-11-20T13:00:00Z'),
            medico,
            o.ativa ?? true,
            o.ativa === false ? agora : null,
            o.ativa === false ? `Refutada no teste ${P}` : null,
            agora,
            o.excluida ? agora : null,
          ],
        );
      const catalogo = await alergia({ alergeno, registro: reg });
      // Texto livre, sem registro clínico: maiúsculas, acento e espaço diferentes do nome do princípio.
      const livreSemRegistro = await alergia({ livre: `dipirona SINTÉTICA ${P} ` });
      const livreComPrincipio = await alergia({ livre: `Corante amarelo ${P}`, tipo: 'intolerancia' });
      await ins(
        'INSERT INTO alergia_paciente_principio (alergia_paciente_id, principio_ativo_cliente_id, criado_em) VALUES (?, ?, ?)',
        [livreComPrincipio, tartrazinaCliente, agora],
      );
      const inativa = await alergia({ alergeno, ativa: false });
      const rascunho = await alergia({ livre: `Rascunho ${P}`, situacao: 'rascunho' });
      const nega = await alergia({ tipo: 'nega_alergias' });
      const excluida = await alergia({ livre: `Excluída ${P}`, excluida: true });
      const outroEstabelecimento = await alergia({ est: outroEst, livre: `Iodo ${P}` });
      return {
        paciente,
        atendimento: atend,
        inscricao: inscricaoMedico,
        registro: reg,
        registroSuspenso: regSuspenso,
        registroDeOutro: regOutro,
        principio: { penicilina, dipirona, tartrazina },
        alergia: {
          catalogo,
          livreSemRegistro,
          livreComPrincipio,
          inativa,
          rascunho,
          nega,
          excluida,
          outroEstabelecimento,
        },
      };
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  }, 120_000);

  it('documentos: toda alergia do estabelecimento, com a de texto livre e a sem registro clínico', async () => {
    const r = await alergias(nucleo, CLIENTE, C, m.paciente);
    expect(r.map((a) => a.id)).toEqual([
      m.alergia.catalogo,
      m.alergia.livreSemRegistro,
      m.alergia.livreComPrincipio,
      m.alergia.inativa,
    ]);
    const [cat, livre, comPrincipio, inativa] = r;
    expect(cat).toMatchObject({
      agente: `Penicilina sintética ${P}`,
      tipo: 'Medicamento',
      registro: m.registro,
      ativa: true,
      registradaEm: '2026-11-20T10:00:00',
      principios: [`Benzilpenicilina sintética ${P}`],
    });
    expect(cat!.profissional).toContain(`Pessoa sintética ${P}`);
    expect(livre).toMatchObject({
      agenteId: null,
      agente: `dipirona SINTÉTICA ${P}`,
      registro: null,
      ativa: true,
      tipo: null,
      principios: [],
    });
    expect(comPrincipio).toMatchObject({
      tipoRegistro: 'intolerancia',
      // O princípio registrado pelo cadastro do hospital aparece pelo nome de lá.
      principios: [`Tartrazina do hospital ${P}`],
    });
    expect(inativa).toMatchObject({ ativa: false, motivoInativacao: `Refutada no teste ${P}` });
  });

  it('versão: as ativas do estabelecimento em ordem', async () => {
    expect(await versaoAlergias(nucleo, CLIENTE, C, m.paciente)).toBe(
      [m.alergia.catalogo, m.alergia.livreSemRegistro, m.alergia.livreComPrincipio].join(','),
    );
  });

  it('prescrição: ativas do cliente inteiro e o alerta da alergia de texto livre', async () => {
    const r = await alergiasDaPrescricao(nucleo, CLIENTE, C, m.paciente);
    expect(r).toEqual([
      { alergia: m.alergia.catalogo, nome: `Penicilina sintética ${P}`, principios: [m.principio.penicilina] },
      { alergia: m.alergia.livreSemRegistro, nome: `dipirona SINTÉTICA ${P}`, principios: [m.principio.dipirona] },
      { alergia: m.alergia.livreComPrincipio, nome: `Corante amarelo ${P}`, principios: [m.principio.tartrazina] },
      { alergia: m.alergia.outroEstabelecimento, nome: `Iodo ${P}`, principios: [] },
    ]);
    const item = (chave: string, produto: number, principio: number): ItemAvaliado => ({
      chave,
      tipo: 'medicamento',
      produtos: [
        {
          produto: {
            produto,
            nome: `Produto ${produto}`,
            principiosAtivos: [principio],
            padronizado: true,
            altoAlerta: false,
            controlado: null,
            antimicrobiano: false,
            doseMinima: null,
            doseMaxima: null,
            viasPermitidas: [],
          },
          dose: 1,
          unidade: 'CP',
        },
      ],
      via: null,
      dosesNoPeriodo: 1,
      intervaloHoras: null,
      aCriterio: false,
      seNecessario: null,
      fichaAntimicrobiano: false,
    });
    const ctx: ContextoAlertas = {
      alergias: r,
      ativos: [],
      paciente: { clearance: null, pesoKg: null },
      tipoAtendimento: 'I',
      alta: false,
      regras: [],
      interacoes: [],
      duplicidade: { porMedicamento: false, porPrincipio: false, consistir: false },
      altaVigilancia: new Set(),
      dietaDeOutro: null,
      hoje: '2026-11-23',
    };
    const al = achados({
      itens: [item('dip', 1, m.principio.dipirona), item('tar', 2, m.principio.tartrazina)],
      ctx,
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    }).filter((a) => a.tipo === 'alergia');
    expect(al.map((a) => a.id).sort()).toEqual(
      [`alergia:1:${m.alergia.livreSemRegistro}`, `alergia:2:${m.alergia.livreComPrincipio}`].sort(),
    );
  });

  it('catálogo: o alérgeno e os princípios do lote', async () => {
    const r = await catalogoAlergias(nucleo, CLIENTE, C);
    expect(r.agentes.filter((a) => a.nome.endsWith(P))).toEqual([
      expect.objectContaining({ nome: `Penicilina sintética ${P}`, tipo: 'Medicamento' }),
    ]);
    expect(r.principios.filter((x) => x.nome.endsWith(P)).map((x) => x.id).sort((a, b) => a - b)).toEqual(
      [m.principio.penicilina, m.principio.dipirona, m.principio.tartrazina].sort((a, b) => a - b),
    );
  });

  it('registros para a alergia: só o do profissional da sessão, sem o suspenso', async () => {
    const r = await registrosParaAlergia(nucleo, CLIENTE, C, m.atendimento, [m.inscricao]);
    expect(r).toEqual([{ registro: m.registro, modelo: 'Evolução sintética', dataHora: '2026-11-20T09:30:00' }]);
    expect(r.some((x) => x.registro === m.registroSuspenso || x.registro === m.registroDeOutro)).toBe(false);
  });
});
