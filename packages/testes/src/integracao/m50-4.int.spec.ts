// M50, etapa 4 (telemedicina), na cópia e sempre em transação desfeita: a teleconsulta abre o atendimento como uma
// consulta pela receita do M20 (atendimento.abrirAtendimento, cenário teleconsulta, pelo executor), a partir da marcação
// do dia, sem senha, e a mesma transação liga a teleconsulta (SGH_ATD_TELECONSULTA em andamento, com o REG e o
// cabeçalho). Sem a sala aberta, a abertura inteira é desfeita (o ponto de salvamento do executor): nenhuma ficha, a
// marcação sem REG. O outro sistema não fica sabendo da modalidade (REPACAGI.TELEATENDIMENTO segue 'N'). Massa
// sintética (operador, paciente; a marcação antiga trazida para hoje como na reprodução do M20); da cópia só os IDs de
// uma ficha recente. Saída só com contagens; nada fica (retrato antes e depois igual).
import {
  abrirSalaTeleconsulta,
  agendarTeleconsulta,
  carregarDominiosVistos,
  entrarSalaEspera,
  operacao,
  teleconsultaPorId,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apoioDaFicha, marcacaoDeHojeDoPaciente } from '../massa/reproducao-atendimento.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

describe.skipIf(!PODE_ESCREVER)(
  'teleconsulta: a abertura do atendimento pela receita do M20 (transação desfeita)',
  () => {
    let a: Ambiente;
    const tiposLogradouro =
      carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos(
        'RICADPAC',
        'TPLGR',
      ) ?? new Set<string>();

    beforeAll(async () => {
      a = await prepararAmbiente();
    });
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    const retrato = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => ({
        recadate: await contar(l, 'SELECT MAX(REG) N FROM RECADATE'),
        ricadpac: await contar(l, 'SELECT MAX(ID) N FROM RICADPAC'),
        tele: await contar(l, 'SELECT COUNT(*) N FROM SGH_ATD_TELECONSULTA'),
        teleMax: await contar(l, 'SELECT COALESCE(MAX(ID), 0) N FROM SGH_ATD_TELECONSULTA'),
      }));

    async function preparo(e: Escritor, comSala: boolean) {
      const usuario = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', usuario),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const p = await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep));
      const paciente = num(p.resultado['idPaciente']);
      const [px] = await e.consultar('SELECT PRONT FROM RICADPAC WHERE ID = ?', [paciente], { teto: 1 });
      const pront = num(px?.['PRONT']);
      const marcacao = await marcacaoDeHojeDoPaciente(e, pront);
      const [h] = await e.consultar('SELECT NOME, CRM, DATA, HORA FROM REPACAGD WHERE ID = ?', [marcacao], {
        teto: 1,
      });
      const t = await agendarTeleconsulta(e, {
        hospital: a.cod,
        marcacao,
        agenda: 1,
        nomeAgenda: 'AGENDA SINTETICA M504',
        crmAgenda: num(h?.['CRM']),
        data: new Date().toISOString().slice(0, 10),
        hora: '0800',
        paciente,
        conta: null,
        por: 'SGH.PORTAL.C1',
      });
      const v = await entrarSalaEspera(e, a.cod, t.id, 1, {
        termo: 'TELE-2026.1',
        local: { uf: 'RJ', municipio: 'PETROPOLIS', tipo: 'residencia' },
        por: 'SGH.PORTAL.C1',
      });
      const f = await apoioDaFicha(e, { tipoAte: 4 });
      // O vínculo de quem abre a sala é o mesmo que abre a ficha (só ele liga a ficha à teleconsulta).
      if (comSala)
        await abrirSalaTeleconsulta(e, a.cod, t.id, v.versao, {
          provedor: 'simulado',
          sala: 'SIM-SALA-M504',
          declaracao: 'CFM-2314-2026.1',
          medico: usuario,
          vinculo: f.profissional,
          cienteAlerta: false,
        });
      const entrada = {
        tipo: 'consulta',
        paciente,
        convenio: f.convenio,
        plano: 'PLANO SINTETICO',
        matricula: '900000000001',
        validadeCarteira: '2030-12-31',
        profissional: f.profissional,
        especialidade: f.especialidade,
        unidade: f.unidade,
        centroCusto: f.centroCusto,
        procedimento: f.procedimento,
        carater: 'eletivo',
        cidPrincipal: f.cid,
        marcacao,
        tipoGuia: 'H',
        teleconsulta: { id: t.id },
      };
      return { exec, entrada, marcacao, pront, tele: t.id, horario: h };
    }

    it('abre a consulta sem senha a partir da marcação e liga a teleconsulta na mesma transação', async () => {
      const antes = await retrato();
      const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const p = await preparo(e, true);
        const g = await p.exec('atendimento.abrirAtendimento', p.entrada);
        const reg = num(g.resultado['reg']);
        const cab = String(g.resultado['cabecalho']);
        const t = await teleconsultaPorId(e, a.cod, p.tele);
        const [m] = await e.consultar('SELECT REGISTRO FROM REPACAGD WHERE ID = ?', [p.marcacao], {
          teto: 1,
        });
        const [s] = await e.consultar(
          'SELECT COUNT(*) N FROM ATCABECATEND_TBSENHAATEND WHERE ID_ATCABECATEND = CAST(CAST(? AS VARCHAR(20)) AS NUMERIC(13,0))',
          [cab],
          { teto: 1 },
        );
        const [i] = await e.consultar(
          'SELECT TELEATENDIMENTO T FROM REPACAGI WHERE NOME = ? AND CRM = ? AND DATA = ? AND HORA = ?',
          [p.horario?.['NOME'], p.horario?.['CRM'], p.horario?.['DATA'], p.horario?.['HORA']],
          { teto: 1 },
        );
        const [x] = await e.consultar(
          'SELECT TIPO FROM SGH_ATD_EXT WHERE HOSPITAL = ? AND REG = ?',
          [a.cod, reg],
          {
            teto: 1,
          },
        );
        return {
          ficha: reg > 0,
          marcacaoLigada: num(m?.['REGISTRO']) === reg,
          semSenha: num(s?.['N']) === 0,
          teleatendimento: String(i?.['T'] ?? 'N').trim() || 'N',
          extensao: String(x?.['TIPO'] ?? '').trim(),
          situacao: t?.situacao,
          regNaTeleconsulta: t?.reg === reg,
          cabecalhoNaTeleconsulta: t?.cabecalho === cab,
          iniciada: t?.iniciadaEm !== null,
        };
      });
      expect(r).toEqual({
        ficha: true,
        marcacaoLigada: true,
        semSenha: true,
        teleatendimento: 'N',
        extensao: 'consulta',
        situacao: 'em-andamento',
        regNaTeleconsulta: true,
        cabecalhoNaTeleconsulta: true,
        iniciada: true,
      });
      expect(await retrato()).toEqual(antes);
      console.log(`[${a.cod}] m50.4 abertura da teleconsulta: ${JSON.stringify(r)}`);
    });

    it('sem a sala aberta, a abertura é desfeita por inteiro (nenhuma ficha; a marcação sem REG)', async () => {
      const antes = await retrato();
      const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const p = await preparo(e, false);
        let recusada = false;
        try {
          await p.exec('atendimento.abrirAtendimento', p.entrada);
        } catch {
          recusada = true;
        }
        const [m] = await e.consultar(
          'SELECT COALESCE(REGISTRO, 0) R FROM REPACAGD WHERE ID = ?',
          [p.marcacao],
          {
            teto: 1,
          },
        );
        const [f] = await e.consultar('SELECT COUNT(*) N FROM RECADATE WHERE PRONT = ?', [p.pront], {
          teto: 1,
        });
        const t = await teleconsultaPorId(e, a.cod, p.tele);
        return {
          recusada,
          marcacaoSemRegistro: num(m?.['R']) === 0,
          fichasDoPaciente: num(f?.['N']),
          situacao: t?.situacao,
          reg: t?.reg ?? null,
        };
      });
      expect(r).toEqual({
        recusada: true,
        marcacaoSemRegistro: true,
        fichasDoPaciente: 0,
        situacao: 'aguardando',
        reg: null,
      });
      expect(await retrato()).toEqual(antes);
      console.log(`[${a.cod}] m50.4 abertura sem sala (desfeita): ${JSON.stringify(r)}`);
    });
  },
);
