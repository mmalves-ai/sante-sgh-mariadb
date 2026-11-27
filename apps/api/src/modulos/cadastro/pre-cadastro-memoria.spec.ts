// 02-AGE 42 (C1-101): contrato de efeito da conversão do pré-cadastro na fonte sintética. A marcação sem prontuário de
// hoje (agenda em memória) é convertida pelo cadastro em memória: a divergência só passa com motivo, a marcação passa a
// ter o paciente, o pré-cadastro fica 'convertido' (não pede mais conversão) e a recepção em memória lista o agendado.
import { afterAll, describe, expect, it } from 'vitest';
import { lembrarAgendaMemoria, PortaAgendaMemoria } from '../agenda/porta-memoria.js';
import { pacientesSinteticos } from '../agenda/modulo.js';
import { marcacaoVista } from '../agenda/visao.js';
import { PortaRecepcaoMemoria } from '../recepcao/porta-memoria.js';
import type { SessaoCadastro } from './comum.js';
import { cadastroMemoriaAtual, lembrarCadastroMemoria, PortaCadastroMemoria } from './porta-memoria.js';
import {
  conversaoEmMemoria,
  converterPreCadastroMemoria,
  previaConversaoMemoria,
} from './pre-cadastro-memoria.js';

const HOJE = '2026-10-21';
const anterior = cadastroMemoriaAtual();
afterAll(() => {
  if (anterior) lembrarCadastroMemoria(anterior);
});

describe('conversão do pré-cadastro em memória (02-AGE 42)', () => {
  it('liga a marcação de hoje ao paciente escolhido e a recepção lista o agendado', async () => {
    const agenda = lembrarAgendaMemoria(
      new PortaAgendaMemoria(
        null,
        async (_c, ids) => pacientesSinteticos(ids),
        () => ({ hoje: HOJE, hora: '07:00' }),
      ),
    );
    lembrarCadastroMemoria(new PortaCadastroMemoria());
    expect(conversaoEmMemoria()).toBe(true);
    const ctx = {
      rede: 'sintetica',
      hospital: '1',
      login: 'SINT.AGENDA',
      correlacao: 'c',
      chaveIdempotencia: 'k-1',
    };
    const m = await agenda.executar(ctx, 'agenda.agendarSemProntuario', {
      agenda: 901,
      data: HOJE,
      hora: '08:00',
      convenio: 10,
      canal: 'telefone',
      nome: 'Pessoa Sintética Sem Prontuário',
      nascimento: '1979-06-15',
      telefone: '31988887777',
    });
    const id = Number(m.resultado['marcacao']);
    const pre = Number(m.resultado['preCadastro']);
    const s = { hospital: '1', rede: 'sintetica', porta: {} } as unknown as SessaoCadastro;

    expect((await previaConversaoMemoria(s, pre, null)).acao).toBe('cadastrar');
    const previa = await previaConversaoMemoria(s, pre, 1003);
    expect(previa).toMatchObject({ acao: 'recusar', codigo: 'dados-divergentes' });
    await expect(converterPreCadastroMemoria(s, { id: pre, paciente: 1003 })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'dados-divergentes' }),
    });
    expect(agenda.preCadastroMemoria('1', pre)?.situacao).toBe('pendente');

    const r = await converterPreCadastroMemoria(s, {
      id: pre,
      paciente: 1003,
      motivoDivergencia: 'Nascimento conferido no documento',
    });
    expect(r).toEqual({ paciente: 1003, marcacoes: 1, cobertura: null });
    const lida = (await agenda.marcacao(ctx, id))!.marcacao;
    expect(lida).toMatchObject({ idPaciente: 1003, situacaoPreCadastro: 'convertido' });
    expect(marcacaoVista(lida).preCadastroAConverter).toBeNull();
    await expect(converterPreCadastroMemoria(s, { id: pre, paciente: 1003 })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'pre-cadastro-nao-pendente' }),
    });

    const recepcao = new PortaRecepcaoMemoria(
      { estado: () => 'verde' },
      { agendadosExternos: (h) => agenda.agendadosDeHojeMemoria(h) },
    );
    const { itens } = await recepcao.agendados(
      { rede: 'sintetica', hospital: '1' },
      { prontuario: lida.prontuario },
    );
    expect(itens).toEqual([
      expect.objectContaining({ tipo: 'consulta', marcacao: id, hora: '08:00', senha: null }),
    ]);
  });
});
