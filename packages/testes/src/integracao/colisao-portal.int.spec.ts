// Regra 3 do M50 (ficha, seção 8: "colisão com outro canal é transparente (o horário ocupado some e o próximo é
// oferecido)"; teste `colisao-portal.int-spec.ts`): sobre a cópia, sempre em transação desfeita e sob a trava da cópia.
// O portal lê os horários livres da agenda (a mesma busca da central, pelas regras do portal); o outro sistema ocupa o
// primeiro horário COMO ELE GRAVA (direto na grade) depois da leitura; a marcação pelo portal (canal "portal", o
// usuário de integração do portal criado pela receita do M04) é recusada pela releitura do executor com "horário
// ocupado", o horário some da releitura e o próximo livre da mesma agenda é oferecido; a marcação no próximo grava como a
// da central (o TP_AGE do call center, D-TPAGE-50) com o canal "portal" na extensão do novo. O ROLLBACK devolve as
// contagens. Massa sintética marcada; saída só com contagens e códigos (nenhum nome, telefone ou documento).
import { buscarVagas, carregarDominiosVistos, ErroOperacao, lerMarcacao, operacao } from '@sgh/legado';
import { type ConfigOnline, horariosDoPortal, proximoOferecido } from '@sgh/dominio-agenda';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agendaLivre,
  convenioAceito,
  diaUtil,
  entradaGrade,
  legadoOcupaHorario,
  relogio,
} from '../massa/reproducao-agenda.js';
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

const somar = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}

describe.skipIf(!PODE_ESCREVER)(
  'portal × outro sistema no mesmo horário, na cópia (transação desfeita)',
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
        repacagd: await contar(l, 'SELECT MAX(ID) N FROM REPACAGD'),
        repacagi: await contar(l, 'SELECT COUNT(*) N FROM REPACAGI WHERE DATA >= CURRENT_DATE'),
        ext: await contar(l, 'SELECT COUNT(*) N FROM SGH_AGE_MARCACAO_EXT'),
      }));

    it('o horário ocupado por fora some, o próximo é oferecido e a marcação nele grava como a da central', async () => {
      const antes = await retrato();
      const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
        // O usuário de integração do portal (receita do M04): as colunas de autoria nunca levam o paciente.
        const portal = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
        await a.executor.executar(
          operacao('acesso.criarUsuarioIntegracao'),
          a.cod,
          usuarioSintetico('usuario-tecnico', portal),
          ctxOperacao(a, 'SGH.TESTE'),
          { escritor: e },
        );
        const exec = (op: string, entrada: unknown) =>
          a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, portal), { escritor: e });
        const ag = await agendaLivre(e);
        const hoje = (await relogio(e)).hoje;
        const dia = await diaUtil(e, ag, somar(hoje, 7));
        await exec('agenda.gerarGrade', entradaGrade(ag, dia));
        const cpf = await cpfLivre(e, (Date.now() + 104_729) % 90_000_000);
        const cep = await cepCompleto(e, tiposLogradouro);
        const pac = num(
          (await exec('cadastro.cadastrarPaciente', pacienteSintetico('com-cep', cpf, cep))).resultado[
            'idPaciente'
          ],
        );
        const conv = await convenioAceito(e, ag);
        const cfg: ConfigOnline = {
          agenda: ag.id,
          ativa: true,
          convenios: [],
          servicos: [],
          antecedenciaHoras: 0,
          horizonteDias: 30,
          cancelaAteHoras: 0,
          precheckin: true,
          valorParticular: null,
        };
        const rel = await relogio(e);
        const lidas = (await buscarVagas(e, { agendas: [ag.id], de: dia, ate: dia })).itens;
        const portalViu = horariosDoPortal(lidas, new Map([[ag.id, cfg]]), rel).itens;
        const escolhido = portalViu[0]!;
        // O outro sistema ocupa o horário escolhido depois da leitura do portal.
        await legadoOcupaHorario(e, ag, escolhido.data, escolhido.hora, portal);
        const base = { agenda: ag.id, paciente: pac, convenio: conv, retorno: false, canal: 'portal' };
        const recusa = await codigo(
          exec('agenda.agendarConsulta', { ...base, data: escolhido.data, hora: escolhido.hora }),
        );
        const relidas = (await buscarVagas(e, { agendas: [ag.id], de: dia, ate: dia })).itens;
        const proximo = proximoOferecido(relidas, { ...escolhido, agenda: ag.id }, cfg, rel);
        const m = await exec('agenda.agendarConsulta', { ...base, data: proximo!.data, hora: proximo!.hora });
        const id = num(m.resultado['marcacao']);
        const lida = await lerMarcacao(e, id);
        const [x] = await e.consultar(
          'SELECT CANAL FROM SGH_AGE_MARCACAO_EXT WHERE HOSPITAL = ? AND ID_REPACAGD = ?',
          [a.cod, id],
          { teto: 1 },
        );
        return {
          portalViuOcupado: portalViu.some((v) => v.hora === escolhido.hora),
          recusa,
          relidaSemOcupado: !relidas.some((v) => v.hora === escolhido.hora),
          proximoDepois: proximo !== null && proximo.hora > escolhido.hora,
          tpAge: lida?.marcacao.tpAge ?? -1,
          canal: String(x?.['CANAL'] ?? '').trim(),
        };
      });
      expect(r).toEqual({
        portalViuOcupado: true,
        recusa: 'horario-ocupado',
        relidaSemOcupado: true,
        proximoDepois: true,
        tpAge: 20,
        canal: 'portal',
      });
      expect(await retrato()).toEqual(antes);
      console.log(`[${a.cod}] colisão pelo portal: ${JSON.stringify(r)}`);
    });
  },
);
