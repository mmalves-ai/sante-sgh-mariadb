// Fila do médico com as pendências lidas pela porta PRÓPRIA da fila (cliente de teste f22_o4, massa sintética do lote,
// prefixo l0402w): previsão de alta, resultado novo e prescrição a renovar vêm do banco; o resto da fila é dublê.
// O QUE ESTE TESTE NÃO PROVA: a regra 2 do M27 (só pacientes com vínculo assistencial: CBO do atendimento, registro no
// episódio, parecer aceito). O recorte "meus" do painel do M23 ainda não tem adaptador próprio e entra como dublê que
// devolve as linhas sempre que o profissional tem ocupação; o vínculo não é conferido contra o banco. Também não mede o
// p95 < 1,5 s da ficha (o painel, a parte cara, é dublê): o tempo abaixo é só a leitura das pendências. Ambas ficam
// PENDENTES até a porta própria dos documentos/painel e não contam como evidência no fechamento do marco.
// Prova aqui: sem profissional cadastrado o serviço não consulta o painel (fila vazia). Só contagens; nenhum dado de pessoa.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PortaDocumentos } from '../documentos-porta.js';
import { ServicoDocumentos } from '../documentos-servico.js';
import { dataHora } from '../registro-porta-propria.js';
import {
  CLIENTE_F22_O4,
  limparMassaWorklist,
  type MassaWorklist,
  montarMassaWorklist,
} from '../worklist-massa.spec-util.js';
import { PortaWorklistPropria } from '../worklist-porta-propria.js';
import { ServicoWorklistMedico } from './worklist-medico.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l0402w';
const FUSO = 'America/Sao_Paulo';
const DIA = 86_400_000;
const LOGIN_MEDICO = `${P}.medico`;

describe.skipIf(SEM_BANCO)(
  'fila do médico: pendências lidas pela porta própria (f22_o4; vínculo do painel é dublê)',
  () => {
    let nucleo: NucleoProprio;
    let m: MassaWorklist;
    let servico: ServicoWorklistMedico;
    const recortes: unknown[] = [];

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassaWorklist(nucleo, P, 904_021_000);
      const agoraLocal = dataHora(m.agora, FUSO)!;
      const entrada = dataHora(new Date(m.agora.getTime() - 2 * DIA), FUSO)!;
      const linha = (
        paciente: number,
        atendimento: number,
        registro: number,
        tipo: 'internacao' | 'externo',
      ) => ({
        paciente,
        nome: `PACIENTE SINTETICO ${paciente}`,
        nomeSocial: null,
        nascimento: '1970-01-01',
        sexo: 'F',
        prontuario: paciente,
        atendimento,
        registro,
        tipo,
        entrada,
        unidade: 'UNIDADE SINTETICA',
        idUnidade: 1,
        leito: tipo === 'internacao' ? '101A' : null,
        convenio: null,
        medico: null,
        alergiasAtivas: 0,
      });
      // O painel do M23 (dublê): o recorte "meus" com ocupação devolve as linhas do vínculo; sem ocupação, nenhuma.
      const docs = {
        destino: 'proprio',
        agora: async () => agoraLocal,
        profissional: async (_c: unknown, login: string) =>
          login === LOGIN_MEDICO
            ? {
                idUsuario: 1,
                idProfissional: 1,
                nome: 'MEDICO SINTETICO',
                cbo: 77,
                cbos: [77],
                especialidades: [],
                permiteRetroativo: false,
                ocupacoes: [{ cbo: 77, codigo: '225125', conselhoAtivo: true }],
              }
            : null,
        painel: async (_c: unknown, f: { meus?: { cbos: readonly number[] } }) => {
          recortes.push(f);
          return {
            linhas: f.meus?.cbos.length
              ? [linha(m.pac1, m.atd[0], m.int.a, 'internacao'), linha(m.pac2, m.atd[1], 0, 'externo')]
              : [],
            limitado: false,
          };
        },
        pendencias: async () => [],
        completudePainel: async () => ({
          evolucoesMedicas: [{ atendimento: m.atd[0], em: agoraLocal }],
          alergiasInformadas: [],
          negas: [],
          valores: [],
          ciencias: [],
          pareceres: [],
        }),
      } as unknown as PortaDocumentos;
      servico = new ServicoWorklistMedico(
        new ServicoDocumentos(docs),
        null,
        new PortaWorklistPropria(nucleo, CLIENTE_F22_O4),
      );
    }, 120_000);
    afterAll(async () => {
      if (nucleo) {
        await nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `limpeza-${P}` }, (e) =>
          limparMassaWorklist(e, P),
        );
        await nucleo.encerrar();
      }
    });

    const c = () => ({
      cliente: CLIENTE_F22_O4,
      estabelecimento: m.estA,
      usuario: null,
      correlacao: P,
      rede: 'rede-teste',
      hospital: P,
    });

    it('as pendências da fila (previsão de alta, resultado novo, prescrição a renovar) vêm da porta própria; tempo só da leitura das pendências', async () => {
      const tempos: number[] = [];
      let fila = await servico.fila(c(), LOGIN_MEDICO);
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        fila = await servico.fila(c(), LOGIN_MEDICO);
        tempos.push(performance.now() - t0);
      }
      expect(fila.semVinculo).toBe(false);
      expect(fila.pacientes.map((p) => p.paciente).sort((a, b) => a - b)).toEqual(
        [m.pac1, m.pac2].sort((a, b) => a - b),
      );
      const p1 = fila.pacientes.find((p) => p.paciente === m.pac1)!;
      const tipos1 = p1.pendencias.map((x) => x.tipo).sort();
      expect(tipos1).toEqual(['prescricao-a-renovar', 'resultado-novo']);
      expect(p1.pendencias.find((x) => x.tipo === 'resultado-novo')?.quantidade).toBe(1);
      expect(p1.pendencias.find((x) => x.tipo === 'prescricao-a-renovar')?.prazo).toBe(
        dataHora(m.fimARenovar, FUSO)!.slice(0, 16),
      );
      expect(p1.previsaoAlta).toBe('2026-12-01');
      // O atendimento externo: o resultado novo conta; prescrição a renovar e previsão de alta são só da internação.
      const p2 = fila.pacientes.find((p) => p.paciente === m.pac2)!;
      expect(p2.pendencias.map((x) => x.tipo)).toEqual(['resultado-novo']);
      expect(p2.previsaoAlta).toBeNull();
      // Só a leitura das pendências sobre o banco (o painel é dublê): não é a prova do p95 da ficha.
      tempos.sort((a, b) => a - b);
      expect(tempos[Math.ceil(tempos.length * 0.95) - 1]!).toBeLessThan(1500);
    });

    it('sem cadastro de profissional: fila vazia e o painel nem é consultado', async () => {
      recortes.length = 0;
      const fila = await servico.fila(c(), `${P}.sem.vinculo`);
      expect(fila).toMatchObject({ semVinculo: true, pacientes: [], total: 0 });
      expect(recortes).toEqual([]);
    });
  },
);
