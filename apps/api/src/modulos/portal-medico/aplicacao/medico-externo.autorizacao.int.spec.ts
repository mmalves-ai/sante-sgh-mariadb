// Regra 6 do M50 (o médico externo vê só o que é dele; DP-43) na cópia, em transação SEMPRE desfeita: o serviço do portal
// do médico externo sobre as portas do legado na mesma transação (a sessão do portal do M26, a agenda e o pedido do M18,
// o extrato do M33). Duas contas SINTÉTICAS de médico externo (autocadastro aprovado pelos solicitantes da cópia com o
// mesmo número e UF; senha e segundo fator de teste) ligadas a dois profissionais diferentes da cópia:
//   - sem o vínculo, nada aparece; com ele, a agenda traz só os agendamentos em que um registro do profissional é o
//     cirurgião, com o paciente mascarado; o extrato traz só os códigos de prestador do profissional;
//   - o pedido de cirurgia da conta A aparece só para a conta A; a conta B não o retira;
//   - só tabelas SGH_ escritas; ROLLBACK.
// Nada da pessoa sai do processo: só contagens e identificadores na asserção.
import { recursoDesligado } from '@sgh/contratos';
import { codigoTotp } from '@sgh/dominio-acesso';
import { nomeMascarado } from '@sgh/dominio-agenda';
import {
  cirurgiaoDeUmCenario,
  decidirAutocadastro,
  escritasDaTransacao,
  lerAgendamento,
  outroProfissionalDeUmCenario,
  profissionalCorpoClinico,
  solicitantesDeCenario,
} from '@sgh/legado';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { portaCirurgiaNaTransacao } from '../../cirurgia/public-api.js';
import { portaRepasseNaTransacao, ServicoRepasse } from '../../repasse/public-api.js';
import { portaSadtNaTransacao, ServicoPortal } from '../../sadt/public-api.js';
import { portaPortalMedicoNaTransacao } from '../porta-legado.js';
import { ServicoPortalMedico } from './servico.js';

const LIGADAS = ['sadt.portal', 'portal.medicoExterno', 'cirurgia.agenda'];
/** As três funcionalidades ligadas no estabelecimento, com cada pré-requisito dispensado (sem parâmetro gravado). */
const CONFIG_LIGADA = {
  chaves: async () =>
    LIGADAS.map((chave) => ({ chave, tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: true })),
  prerequisitos: async () =>
    LIGADAS.flatMap((recurso) =>
      (recursoDesligado(recurso)?.prerequisitos ?? []).map((p) => ({
        recurso,
        tipo: p.tipo,
        situacao: 'dispensado',
        validade: null,
      })),
    ),
  valoresParametro: async () => [],
} as unknown as ConstructorParameters<typeof ServicoPortal>[2];
const SENHA = 'frase-sintetica-longa-m503';

describe.skipIf(!PODE_ESCREVER)(
  'autorização do portal do médico externo na cópia (transação desfeita)',
  () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('só a agenda, o extrato e os pedidos do próprio profissional; o pedido de A não é de B; só SGH_', async () => {
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m503-aut' }, async (e) => {
        const sadt = portaSadtNaTransacao(e, a.executor);
        const cirurgia = portaCirurgiaNaTransacao(e, a.executor);
        const sessoes = new ServicoPortal(sadt, a.c.rede, CONFIG_LIGADA, randomBytes(32), 'Sante SGH', a.cod);
        const servico = new ServicoPortalMedico(
          sessoes,
          sadt,
          portaPortalMedicoNaTransacao(e),
          cirurgia,
          new ServicoRepasse(portaRepasseNaTransacao(e, a.executor), null as never, null, null),
          CONFIG_LIGADA,
          a.c.rede,
        );
        const quem = {
          rede: a.c.rede,
          hospital: a.cod,
          login: 'SGH.TESTE.M503',
          estacao: 'int',
          correlacao: 'int-m503',
        };

        // Dois solicitantes da cópia com número e UF (só os identificadores) e dois profissionais diferentes.
        const sols = await solicitantesDeCenario(e, 2);
        expect(sols).toHaveLength(2);
        const cir = await cirurgiaoDeUmCenario(e);
        if (!cir) throw new Error('A cópia não tem agendamento do bloco com cirurgião.');
        const outro = await outroProfissionalDeUmCenario(e, cir.profissional);
        if (outro === null) throw new Error('A cópia não tem outro profissional com registro.');

        async function conta(i: number) {
          const s = sols[i] as { id: number; uf: string; numero: string };
          const { uf, numero } = s;
          const cad = await sessoes.autocadastro(
            a.cod,
            {
              nome: `Medico externo sintetico ${i}`,
              conselho: 'CRM',
              uf,
              numero,
              email: `m503-${i}@portal.test`,
              senha: SENHA,
              aceiteTermo: true,
            },
            `10.50.3.${10 + i}`,
          );
          const segredo = new URL(cad.otpauth).searchParams.get('secret') ?? '';
          const acesso = await sadt.acessoDoMedico(a.c, { conselho: 'CRM', uf, numero });
          await decidirAutocadastro(e, {
            hospital: a.cod,
            id: acesso!.id,
            aprovar: true,
            solicitante: s.id,
            motivo: null,
            usuario: 'SGH.TESTE.M503',
          });
          const entrada = await sessoes.entrarMedico(
            a.cod,
            { conselho: 'CRM', uf, numero, senha: SENHA, codigo: codigoTotp(segredo, Date.now()) },
            `10.50.3.${10 + i}`,
          );
          return { id: entrada.id, csrf: entrada.csrf, acesso: acesso!.id };
        }
        const A = await conta(0);
        const B = await conta(1);
        const sA = () => sessoes.sessao(A.id);
        const sB = () => sessoes.sessao(B.id);

        // Sem o vínculo, nada aparece.
        expect((await servico.agenda(sA(), A.id, { de: cir.dia, ate: cir.dia })).vinculado).toBe(false);
        expect((await servico.extrato(sA(), A.id, { competencia: null })).extrato).toBeNull();

        await servico.vincular(quem, A.acesso, cir.profissional);
        await servico.vincular(quem, B.acesso, outro);
        // O mesmo profissional não vai a duas contas.
        await expect(servico.vincular(quem, B.acesso, cir.profissional)).rejects.toMatchObject({
          status: 409,
        });

        const profA = await profissionalCorpoClinico(e, cir.profissional);
        const registrosA = new Set((profA?.registros ?? []).map((x) => x.id));
        const codigosA = new Set((profA?.registros ?? []).map((x) => x.codigo));
        const agA = await servico.agenda(sA(), A.id, { de: cir.dia, ate: cir.dia });
        expect(agA.vinculado).toBe(true);
        expect(agA.agendamentos.length).toBeGreaterThan(0);
        for (const x of agA.agendamentos) {
          const lido = await lerAgendamento(e, x.agendamento as number);
          expect(registrosA.has(Number(lido?.pares['ID_CRM']))).toBe(true);
          expect(x.paciente).toBe(nomeMascarado(lido?.paciente ?? ''));
        }
        const agB = await servico.agenda(sB(), B.id, { de: cir.dia, ate: cir.dia });
        const idsA = new Set(agA.agendamentos.map((x) => x.agendamento));
        expect(agB.agendamentos.some((x) => idsA.has(x.agendamento))).toBe(false);

        const exA = await servico.extrato(sA(), A.id, { competencia: null });
        expect(exA.extrato?.prestadores.every((p) => codigosA.has(p))).toBe(true);
        expect(exA.extrato?.lancamentos.every((l) => codigosA.has(l.prestador))).toBe(true);

        // O pedido de A: só A o vê; B não o retira.
        const op = await servico.opcoes(sA(), A.id);
        const relogio = await cirurgia.relogio(a.c);
        const amanha = new Date(`${relogio.hoje}T00:00:00Z`);
        amanha.setUTCDate(amanha.getUTCDate() + 7);
        const procs = await servico.procedimentos(sA(), A.id, 'COLECIST');
        const procedimento = procs[0]?.codigo ?? (await cirurgia.buscarProcedimentos(a.c, 'HERN'))[0]?.codigo;
        if (!procedimento || !op.salas[0] || !op.convenios[0])
          throw new Error('A cópia não tem sala, convênio ou procedimento.');
        const p = await servico.pedir(sA(), A.id, {
          sala: op.salas[0].codigo,
          data: amanha.toISOString().slice(0, 10),
          hora: '0800',
          duracaoMin: 60,
          procedimento,
          convenio: op.convenios[0].codigo,
          carater: 2,
          anestesia: 0,
          paciente: { nome: 'PACIENTE SINTETICO DO M503', nascimento: '1970-05-02' },
        });
        const deA = await servico.agenda(sA(), A.id, { de: relogio.hoje, ate: null });
        expect(deA.pedidos.map((x) => x.id)).toContain(p.id);
        const deB = await servico.agenda(sB(), B.id, { de: relogio.hoje, ate: null });
        expect(deB.pedidos.map((x) => x.id)).not.toContain(p.id);
        await expect(servico.retirar(sB(), B.id, p.id, null)).rejects.toMatchObject({ status: 409 });
        await servico.retirar(sA(), A.id, p.id, null);

        const escritas = await escritasDaTransacao(e);
        return {
          agendaA: agA.agendamentos.length,
          tabelas: escritas.map((w) => w.tabela),
        };
      });
      expect(r.agendaA).toBeGreaterThan(0);
      expect(r.tabelas.length).toBeGreaterThan(0);
      expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
      expect(r.tabelas).toEqual(
        expect.arrayContaining(['SGH_SADT_PORTAL_ACESSO', 'SGH_CC_AGENDA_ESTADO', 'SGH_TRILHA']),
      );
    });
  },
);
