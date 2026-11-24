// Regras da F3.9-6: mensagens ao paciente (L133), pacotes e entregas de parceiros (L134) e classificação externa (L140).
import { describe, expect, it } from 'vitest';
import {
  conferirClassificacaoRecebida,
  perfisDoPaciente,
  perfisParaEnvio,
  prazoAtendimento,
  situacaoNaChegada,
  validarPerfilPrioridade,
} from './classificacao-externa.js';
import {
  destinoMensagemValido,
  escolherDestino,
  fusoEmMinutos,
  interpretarResposta,
  momentoDoEnvio,
  montarTexto,
  podeCancelarPedido,
  podePedirEnvio,
  situacaoAposRetorno,
  validarModeloMensagem,
  validarRegraEnvio,
} from './mensagens-paciente.js';
import {
  entregaDevida,
  lerAgenda,
  meioAceitaFormato,
  podeMudarEntrega,
  conferirRevisaoMinimizacao,
  revisaoEmDia,
  revisaoVencida,
  validarPacote,
} from './pacotes-entregas.js';

const codigos = (e: readonly { codigo: string }[]) => e.map((x) => x.codigo);

describe('mensagens ao paciente (L133)', () => {
  const modelo = {
    codigo: 'conf',
    descricao: 'Confirmação',
    finalidade: 'confirmacao' as const,
    canal: 'whatsapp' as const,
    assunto: null,
    corpo: 'Olá {{paciente_nome}}, confirma {{data}} às {{hora}}? Responda SIM ou NAO.',
    respostaConfirmacao: 'SIM',
    respostaRecusa: 'NAO',
    janelaInicio: '08:00',
    janelaFim: '20:00',
    vigenciaInicio: null,
    vigenciaFim: null,
  };
  it('aceita o modelo bem formado e recusa variável desconhecida, respostas iguais, e-mail sem assunto', () => {
    expect(validarModeloMensagem(modelo)).toEqual([]);
    expect(codigos(validarModeloMensagem({ ...modelo, corpo: 'Oi {{cpf}}' }))).toEqual([
      'variavel-desconhecida',
    ]);
    expect(codigos(validarModeloMensagem({ ...modelo, respostaRecusa: 'sim' }))).toEqual([
      'respostas-iguais',
    ]);
    expect(codigos(validarModeloMensagem({ ...modelo, canal: 'email' }))).toEqual(['assunto-obrigatorio']);
    expect(codigos(validarModeloMensagem({ ...modelo, janelaFim: '07:00' }))).toEqual(['janela-invertida']);
  });
  it('a regra usa o canal e a finalidade compatíveis com o aviso e exige antecedência no lembrete', () => {
    const r = {
      codigo: 'lemb',
      descricao: 'Lembrete',
      gatilho: 'lembrete_agendamento' as const,
      canal: 'whatsapp' as const,
      antecedenciaMinutos: 1440,
      horaInicio: '08:00',
      horaFim: '20:00',
      maximoEnviosPaciente: 2,
    };
    const m = { finalidade: 'lembrete' as const, canal: 'whatsapp' as const, ativo: true };
    expect(validarRegraEnvio(r, m)).toEqual([]);
    expect(codigos(validarRegraEnvio(r, { ...m, canal: 'sms' }))).toEqual(['canal-diferente']);
    expect(codigos(validarRegraEnvio(r, { ...m, finalidade: 'aviso' }))).toEqual(['finalidade-incompativel']);
    expect(codigos(validarRegraEnvio({ ...r, antecedenciaMinutos: null }, m))).toEqual([
      'antecedencia-obrigatoria',
    ]);
    expect(codigos(validarRegraEnvio(r, { ...m, ativo: false }))).toEqual(['modelo-inativo']);
  });
  it('o momento do envio cabe no horário do dia, sempre para mais cedo, e não sai depois do evento', () => {
    const agora = new Date('2026-11-24T12:00:00Z');
    // Consulta 26/11 07:00 local (10:00Z), 1 h antes = 06:00 local, antes da janela: vai para 25/11 20:00 local.
    expect(
      momentoDoEnvio({
        referencia: new Date('2026-11-26T10:00:00Z'),
        antecedenciaMinutos: 60,
        horaInicio: '08:00',
        horaFim: '20:00',
        agora,
      })?.toISOString(),
    ).toBe('2026-11-25T23:00:00.000Z');
    // 22:00 local: depois da janela, puxa para 20:00 do mesmo dia.
    expect(
      momentoDoEnvio({
        referencia: new Date('2026-11-27T01:00:00Z'),
        antecedenciaMinutos: 0,
        horaInicio: '08:00',
        horaFim: '20:00',
        agora,
      })?.toISOString(),
    ).toBe('2026-11-26T23:00:00.000Z');
    // Já passou e o evento ainda não: envia agora (agora 09:00 local, dentro da janela).
    expect(
      momentoDoEnvio({
        referencia: new Date('2026-11-24T18:00:00Z'),
        antecedenciaMinutos: 1440,
        horaInicio: '08:00',
        horaFim: '20:00',
        agora,
      }),
    ).toEqual(agora);
    // O evento já passou: não envia.
    expect(
      momentoDoEnvio({
        referencia: new Date('2026-11-24T11:00:00Z'),
        antecedenciaMinutos: 60,
        horaInicio: null,
        horaFim: null,
        agora,
      }),
    ).toBeNull();
  });
  it('aviso sem evento futuro fora do horário vai para a próxima abertura; dentro, sai agora', () => {
    const base = { referencia: null, antecedenciaMinutos: null, horaInicio: '08:00', horaFim: '20:00' };
    // 22:00 em Brasília (01:00Z): próxima abertura 08:00 do dia seguinte (11:00Z).
    expect(momentoDoEnvio({ ...base, agora: new Date('2026-11-25T01:00:00Z') })?.toISOString()).toBe(
      '2026-11-25T11:00:00.000Z',
    );
    // 06:00 em Brasília (09:00Z): abertura 08:00 do mesmo dia.
    expect(momentoDoEnvio({ ...base, agora: new Date('2026-11-24T09:00:00Z') })?.toISOString()).toBe(
      '2026-11-24T11:00:00.000Z',
    );
    const dentro = new Date('2026-11-24T15:00:00Z');
    expect(momentoDoEnvio({ ...base, agora: dentro })).toEqual(dentro);
    // O mesmo 23:30Z é 20:30 em Brasília (fora) e 19:30 em Manaus (dentro).
    const t = new Date('2026-12-01T23:30:00Z');
    expect(momentoDoEnvio({ ...base, agora: t, fusoMinutos: -240 })).toEqual(t);
    expect(momentoDoEnvio({ ...base, agora: t })?.toISOString()).toBe('2026-12-02T11:00:00.000Z');
  });
  it('o fuso do estabelecimento sai do nome IANA', () => {
    const t = new Date('2026-12-01T12:00:00Z');
    expect(fusoEmMinutos('America/Sao_Paulo', t)).toBe(-180);
    expect(fusoEmMinutos('America/Manaus', t)).toBe(-240);
    expect(fusoEmMinutos('America/Rio_Branco', t)).toBe(-300);
    expect(fusoEmMinutos('Fuso/Invalido', t)).toBe(-180);
  });
  it('o destino sai do cadastro do paciente, com o consentimento de comunicação do contato', () => {
    const contatos = [
      {
        tipo: 'telefone' as const,
        endereco: '11988887777',
        principal: false,
        aceitaComunicacao: false,
        usaAplicativo: true,
      },
      {
        tipo: 'telefone' as const,
        endereco: '11999990000',
        principal: true,
        aceitaComunicacao: true,
        usaAplicativo: true,
      },
      {
        tipo: 'telefone' as const,
        endereco: '11977776666',
        principal: false,
        aceitaComunicacao: true,
        usaAplicativo: false,
      },
      {
        tipo: 'email' as const,
        endereco: 'Pac@Exemplo.com',
        principal: true,
        aceitaComunicacao: true,
        usaAplicativo: false,
      },
    ];
    expect(escolherDestino('whatsapp', contatos, null)).toEqual({
      destino: '11999990000',
      noCadastro: true,
      consentido: true,
    });
    expect(escolherDestino('whatsapp', contatos, '+55 (11) 99999-0000')).toMatchObject({
      noCadastro: true,
      consentido: true,
    });
    expect(escolherDestino('whatsapp', contatos, '11988887777')).toMatchObject({
      noCadastro: true,
      consentido: false,
    });
    expect(escolherDestino('whatsapp', contatos, '11977776666')).toMatchObject({
      noCadastro: true,
      consentido: false,
    });
    expect(escolherDestino('sms', contatos, '11977776666')).toMatchObject({
      noCadastro: true,
      consentido: true,
    });
    expect(escolherDestino('sms', contatos, '21911112222')).toMatchObject({
      noCadastro: false,
      consentido: false,
    });
    expect(escolherDestino('email', contatos, 'pac@exemplo.com')).toMatchObject({
      noCadastro: true,
      consentido: true,
    });
    expect(escolherDestino('push', contatos, 'aparelho-123')).toMatchObject({ noCadastro: false });
    expect(escolherDestino('sms', [], null)).toEqual({ destino: null, noCadastro: false, consentido: false });
  });
  it('destino, consentimento, descadastro e limite por paciente', () => {
    expect(destinoMensagemValido('whatsapp', '(11) 99999-0000')).toBe(true);
    expect(destinoMensagemValido('sms', '1234')).toBe(false);
    expect(destinoMensagemValido('email', 'a@b.com')).toBe(true);
    const base = {
      canal: 'sms' as const,
      destino: '11999990000' as string | null,
      destinoNoCadastro: true,
      exigeConsentimento: true,
      temConsentimento: true,
      descadastradoNoCanal: false,
      maximoEnviosPaciente: 1,
      enviosDaRegraAoPaciente: 0,
      regraAtiva: true,
    };
    expect(podePedirEnvio(base)).toEqual([]);
    expect(codigos(podePedirEnvio({ ...base, temConsentimento: false }))).toEqual(['sem-consentimento']);
    expect(codigos(podePedirEnvio({ ...base, descadastradoNoCanal: true }))).toEqual(['descadastrado']);
    expect(codigos(podePedirEnvio({ ...base, enviosDaRegraAoPaciente: 1 }))).toEqual(['limite-atingido']);
    expect(codigos(podePedirEnvio({ ...base, exigeConsentimento: false, temConsentimento: false }))).toEqual(
      [],
    );
    expect(codigos(podePedirEnvio({ ...base, destinoNoCadastro: false, temConsentimento: false }))).toEqual([
      'destino-fora-do-cadastro',
    ]);
    expect(codigos(podePedirEnvio({ ...base, destino: null, destinoNoCadastro: false }))).toEqual([
      'sem-contato',
    ]);
  });
  it('monta o texto e aponta o que falta', () => {
    expect(montarTexto('Oi {{paciente_nome}} {{data}}', { paciente_nome: 'Fulano', data: '01/12' })).toEqual({
      texto: 'Oi Fulano 01/12',
      faltando: [],
    });
    expect(montarTexto('{{hora}}', {}).faltando).toEqual(['hora']);
  });
  it('a situação só avança pelos retornos; descadastro bloqueia o canal; só o pendente cancela', () => {
    expect(situacaoAposRetorno('enviado', 'entrega').situacao).toBe('entregue');
    expect(situacaoAposRetorno('lido', 'entrega').situacao).toBe('lido');
    expect(situacaoAposRetorno('entregue', 'resposta').situacao).toBe('respondido');
    expect(situacaoAposRetorno('enviado', 'falha').situacao).toBe('falha');
    expect(situacaoAposRetorno('lido', 'falha').situacao).toBe('lido');
    expect(situacaoAposRetorno('cancelado', 'entrega').situacao).toBe('cancelado');
    expect(situacaoAposRetorno('entregue', 'descadastro')).toEqual({
      situacao: 'entregue',
      bloqueiaCanal: true,
    });
    expect(podeCancelarPedido('pendente')).toBe(true);
    expect(podeCancelarPedido('enviado')).toBe(false);
  });
  it('interpreta a resposta pelas respostas do modelo', () => {
    expect(interpretarResposta(' sim ', 'SIM', 'NÃO')).toBe('confirmado');
    expect(interpretarResposta('nao', 'SIM', 'NÃO')).toBe('cancelado');
    expect(interpretarResposta('quero remarcar', 'SIM', 'NÃO')).toBe('reagendar');
    expect(interpretarResposta('ok', 'SIM', 'NÃO')).toBe('outro');
  });
});

describe('pacotes e entregas de parceiros (L134)', () => {
  const pacote = {
    codigo: 'uti-dia',
    nome: 'Índices de UTI',
    conteudo: 'Internações em UTI do período',
    formato: 'csv' as const,
    meioEntrega: 'sftp' as const,
    periodicidade: 'diaria' as const,
    agenda: '02:00',
    anonimizacao: 'pseudonimizada' as const,
    janelaDias: null,
  };
  const campo = {
    sequencia: 1,
    entidade: 'internacao',
    campo: 'data_entrada',
    rotuloSaida: 'entrada',
    tratamento: 'original' as const,
    dadoSensivel: false,
    justificativa: 'Cálculo do tempo de permanência na UTI',
  };
  it('aceita o pacote mínimo e recusa campo sensível original, agenda inválida, sem campos e meio incompatível', () => {
    expect(validarPacote(pacote, [campo])).toEqual([]);
    expect(codigos(validarPacote(pacote, [{ ...campo, dadoSensivel: true }]))).toEqual([
      'sensivel-sem-tratamento',
    ]);
    expect(codigos(validarPacote({ ...pacote, agenda: '25:00' }, [campo]))).toEqual(['agenda-invalida']);
    expect(codigos(validarPacote(pacote, []))).toEqual(['sem-campos']);
    expect(codigos(validarPacote({ ...pacote, formato: 'fhir' }, [campo]))).toEqual(['formato-incompativel']);
    expect(codigos(validarPacote({ ...pacote, anonimizacao: 'agregada' }, [campo]))).toEqual([
      'agregada-com-individual',
    ]);
    expect(codigos(validarPacote(pacote, [campo, { ...campo, sequencia: 2 }]))).toEqual(['campo-repetido']);
    expect(codigos(validarPacote(pacote, [{ ...campo, justificativa: 'x' }]))).toEqual([
      'justificativa-obrigatoria',
    ]);
    expect(meioAceitaFormato('webhook', 'fhir')).toBe(true);
  });
  it('lê a agenda de cada periodicidade', () => {
    expect(lerAgenda('diaria', '02:00')).toEqual({ tipo: 'diaria', minuto: 120 });
    expect(lerAgenda('semanal', 'seg 06:30')).toEqual({ tipo: 'semanal', diaSemana: 1, minuto: 390 });
    expect(lerAgenda('mensal', '05 03:00')).toEqual({ tipo: 'mensal', dia: 5, minuto: 180 });
    expect(lerAgenda('mensal', '30 03:00')).toBeNull();
  });
  it('a entrega devida cobre do fim da última até o último agendado, e nada se já entregue', () => {
    const agora = new Date('2026-11-24T12:00:00Z'); // 09:00 local
    const d = entregaDevida({
      periodicidade: 'diaria',
      agenda: '02:00',
      janelaDias: null,
      ultimoFim: null,
      agora,
    });
    expect(d?.fim.toISOString()).toBe('2026-11-24T05:00:00.000Z');
    expect(d?.inicio.toISOString()).toBe('2026-11-23T05:00:00.000Z');
    expect(
      entregaDevida({ periodicidade: 'diaria', agenda: '02:00', janelaDias: null, ultimoFim: d!.fim, agora }),
    ).toBeNull();
    const atrasada = entregaDevida({
      periodicidade: 'diaria',
      agenda: '02:00',
      janelaDias: null,
      ultimoFim: new Date('2026-11-21T05:00:00Z'),
      agora,
    });
    expect(atrasada?.inicio.toISOString()).toBe('2026-11-21T05:00:00.000Z');
    expect(
      entregaDevida({ periodicidade: 'sob_demanda', agenda: null, janelaDias: null, ultimoFim: null, agora }),
    ).toBeNull();
    const semanal = entregaDevida({
      periodicidade: 'semanal',
      agenda: 'seg 06:00',
      janelaDias: null,
      ultimoFim: null,
      agora,
    });
    expect(semanal?.fim.toISOString()).toBe('2026-11-23T09:00:00.000Z');
  });
  it('a entrega só anda para a frente; revisão vencida', () => {
    expect(podeMudarEntrega('gerada', 'enviada')).toBe(true);
    expect(podeMudarEntrega('enviada', 'confirmada')).toBe(true);
    expect(podeMudarEntrega('confirmada', 'rejeitada')).toBe(false);
    expect(podeMudarEntrega('gerada', 'confirmada')).toBe(false);
    expect(revisaoVencida('2026-11-01', '2026-11-24')).toBe(true);
    expect(revisaoVencida(null, '2026-11-24')).toBe(false);
    expect(revisaoEmDia(null, '2026-11-24')).toBe(false);
    expect(revisaoEmDia('2026-11-01', '2026-11-24')).toBe(false);
    expect(revisaoEmDia('2027-11-24', '2026-11-24')).toBe(true);
    const c = (x: Record<string, unknown> = {}) => ({
      campo: 'entrada',
      dadoSensivel: false,
      tratamento: 'original',
      justificativa: 'Cálculo do índice',
      ...x,
    });
    expect(conferirRevisaoMinimizacao([c()])).toEqual([]);
    expect(codigos(conferirRevisaoMinimizacao([]))).toEqual(['sem-campos']);
    expect(codigos(conferirRevisaoMinimizacao([c({ justificativa: 'x' })]))).toEqual(['sem-justificativa']);
    expect(codigos(conferirRevisaoMinimizacao([c({ dadoSensivel: true })]))).toEqual([
      'sensivel-sem-tratamento',
    ]);
  });
});

describe('classificação de risco externa (L140)', () => {
  const perfil = {
    codigo: 'gest',
    descricao: 'Gestante',
    codigoExterno: 'G1',
    condicaoPreferencial: 'gestante' as const,
    ordemPrioridade: 1,
    ativo: true,
  };
  it('perfis: validação, envio na ordem com o código externo, e os do paciente', () => {
    expect(validarPerfilPrioridade(perfil)).toEqual([]);
    expect(codigos(validarPerfilPrioridade({ ...perfil, codigo: 'com espaço' }))).toEqual([
      'codigo-invalido',
    ]);
    const idoso = {
      ...perfil,
      codigo: 'ido',
      codigoExterno: null,
      condicaoPreferencial: 'idoso' as const,
      ordemPrioridade: 0,
    };
    const inativo = { ...perfil, codigo: 'x', ativo: false };
    expect(perfisParaEnvio([perfil, idoso, inativo]).map((p) => p.codigo)).toEqual(['ido', 'G1']);
    expect(perfisDoPaciente([perfil, idoso], { idadeAnos: 70, condicoes: [] }).map((p) => p.codigo)).toEqual([
      'ido',
    ]);
    expect(
      perfisDoPaciente([perfil, idoso], { idadeAnos: 30, condicoes: ['gestante'] }).map((p) => p.codigo),
    ).toEqual(['gest']);
  });
  it('confere a recebida contra o atendimento do pronto atendimento', () => {
    const r = {
      identificadorExterno: 'T-1',
      codigoPrioridade: 'AMARELO',
      cor: 'amarelo',
      tempoAlvoMinutos: 60,
      classificadoEm: new Date('2026-11-24T12:10:00Z'),
      recebidoEm: new Date('2026-11-24T12:11:00Z'),
    };
    const a = {
      existe: true,
      prontoAtendimento: true,
      entradaEm: new Date('2026-11-24T12:00:00Z'),
      encerrado: false,
    };
    expect(conferirClassificacaoRecebida(r, a)).toEqual([]);
    expect(codigos(conferirClassificacaoRecebida(r, { ...a, prontoAtendimento: false }))).toEqual([
      'nao-pronto-atendimento',
    ]);
    expect(codigos(conferirClassificacaoRecebida(r, { ...a, encerrado: true }))).toEqual([
      'atendimento-encerrado',
    ]);
    expect(codigos(conferirClassificacaoRecebida(r, { ...a, existe: false }))).toEqual([
      'atendimento-inexistente',
    ]);
    expect(
      codigos(conferirClassificacaoRecebida({ ...r, classificadoEm: new Date('2026-11-24T11:00:00Z') }, a)),
    ).toEqual(['antes-da-entrada']);
    expect(codigos(conferirClassificacaoRecebida({ ...r, tempoAlvoMinutos: 5000 }, a))).toEqual([
      'tempo-alvo-invalido',
    ]);
  });
  it('a mais nova vale; a atrasada entra substituída; a rejeitada não substitui', () => {
    const t = (h: string) => new Date(`2026-11-24T${h}:00Z`);
    expect(situacaoNaChegada(false, t('12:30'), [{ id: 1, classificadoEm: t('12:10') }])).toEqual({
      situacao: 'recebida',
      substitui: [1],
    });
    expect(situacaoNaChegada(false, t('12:05'), [{ id: 1, classificadoEm: t('12:10') }])).toEqual({
      situacao: 'substituida',
      substitui: [],
    });
    expect(situacaoNaChegada(true, t('12:30'), [{ id: 1, classificadoEm: t('12:10') }])).toEqual({
      situacao: 'rejeitada',
      substitui: [],
    });
    expect(prazoAtendimento(t('12:00'), 60)?.toISOString()).toBe('2026-11-24T13:00:00.000Z');
  });
});
