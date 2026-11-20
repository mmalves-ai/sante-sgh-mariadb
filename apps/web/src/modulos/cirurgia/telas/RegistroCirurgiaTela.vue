<script setup lang="ts">
// Registro de cirurgia (ficha do M18, seção 7): `/cirurgia/registro`. As cirurgias realizadas do período com os
// procedimentos, a equipe por função, os tempos e o casamento com o agendamento (registrado aqui, revisado por
// pessoa, ou a sugestão por atendimento, sala e dia, para revisar); e o registro do ato (cirurgia.registrarCirurgia):
// o procedimento, a equipe, os tempos (o término depois do início; a anestesia envolvendo), o porte, o potencial de
// contaminação e o que não tem lugar no outro sistema (entrada e saída de sala, incisão, ASA).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { conferirTempos, porteSugerido } from '@sgh/dominio-cirurgia';
import { dataBr, horaDoContrato } from '../../agenda/formato.js';
import {
  buscarProcedimentos,
  lerAgendamento,
  listarRealizadas,
  novaChave,
  registrarCirurgia,
  revisarLigacao,
} from '../api-cirurgia.js';
import AvisoCirurgia from '../componentes/AvisoCirurgia.vue';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';
import { profissionalDaEscolha, usarCirurgia } from '../usar-cirurgia.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const { opcoes, pode, motivoRegistro, salas, salasPermitidas, profissionais, convenios } = usarCirurgia();
const comVazio = (l: { valor: string; rotulo: string }[], rotulo = t('cirurgia.escolha')) => [
  { valor: '', rotulo },
  ...l,
];

// ── Realizadas ──
const de = ref('');
const ate = ref('');
const regBusca = ref('');
const salaBusca = ref('');
const filtro = ref({ de: '', ate: '', reg: '', sala: '' });
/** Só os dígitos do atendimento; vazio quando não for um número. */
const inteiroDe = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const lista = useQuery({
  queryKey: computed(() => ['cirurgia', 'realizadas', filtro.value]),
  queryFn: () =>
    listarRealizadas({
      de: filtro.value.de || null,
      ate: filtro.value.ate || null,
      reg: inteiroDe(filtro.value.reg),
      sala: inteiroDe(filtro.value.sala),
    }),
});
const podeRevisar = pode('ligacao');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function revisar(realizada: number, agendamento: number | null): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await revisarLigacao(realizada, { agendamento }, novaChave('ligacao'));
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['cirurgia', 'realizadas'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Registro do ato ──
const podeRegistrar = pode('cirurgia.registrarCirurgia');
const agendamento = ref<number | null>(
  typeof rota.query['agendamento'] === 'string' ? Number(rota.query['agendamento']) : null,
);
const fReg = ref('');
const fData = ref('');
const fSala = ref('');
const fConvenio = ref('');
const fPorte = ref('M');
const fPotencial = ref('L');
const fCarater = ref('2');
const fAnestesia = ref('');
/** Horas do ato (HH:MM ou HHMM como digitadas). */
const horas = reactive({
  inicio: '',
  fim: '',
  inicioAnestesia: '',
  fimAnestesia: '',
  entradaSala: '',
  incisao: '',
  saidaSala: '',
});
const CAMPOS_HORA = [
  'inicio',
  'fim',
  'inicioAnestesia',
  'fimAnestesia',
  'entradaSala',
  'incisao',
  'saidaSala',
] as const;
const fCid = ref('');
const fPressao = ref('');
const fPulso = ref('');
const fSupuracao = ref(false);
const USOS = ['tubo', 'antimicrobiano', 'sonda', 'cateter', 'puncao'] as const;
const usos = ref<Record<(typeof USOS)[number], { usado: boolean; descricao: string }>>({
  tubo: { usado: false, descricao: '' },
  antimicrobiano: { usado: false, descricao: '' },
  sonda: { usado: false, descricao: '' },
  cateter: { usado: false, descricao: '' },
  puncao: { usado: false, descricao: '' },
});
const fEspecialidade = ref('');
const fTecnica = ref('0');
const fCirurgiao = ref('');
const fAnestesista = ref('');
const fAuxiliar = ref('');
const fAsa = ref('');
const fObservacao = ref('');
/** Motivo da exceção da trava da incisão (ato sem agendamento com a hora da incisão; o supervisor, em urgência). */
const fMotivoExcecao = ref('');
const termoProc = ref('');
const procs = ref<{ codigo: number; nome: string }[]>([]);
const procedimento = ref<{ codigo: number; nome: string } | null>(null);
async function procurarProcedimento(): Promise<void> {
  procs.value = termoProc.value.trim().length >= 3 ? await buscarProcedimentos(termoProc.value.trim()) : [];
}
const origem = useQuery({
  queryKey: computed(() => ['cirurgia', 'agendamento', agendamento.value ?? 0]),
  queryFn: () => lerAgendamento(agendamento.value ?? 0),
  enabled: computed(() => agendamento.value !== null),
});
watch(
  () => origem.data.value,
  (o) => {
    if (!o) return;
    const a = o.agendamento;
    fReg.value = a.reg ? String(a.reg) : fReg.value;
    fData.value = a.data;
    fSala.value = String(a.sala);
    fConvenio.value = String(a.convenio);
    horas.inicio = a.hora;
    horas.fim = a.fim;
    fEspecialidade.value = a.especialidade ? String(a.especialidade) : '';
    procedimento.value = a.procedimento;
    const par = (f: string) => {
      const m = a.equipe.find((x) => x.funcao === f);
      const p = m ? opcoes.data.value?.profissionais.find((x) => x.id === m.id) : undefined;
      return p ? `${p.id}:${p.cod}` : '';
    };
    fCirurgiao.value = par('cirurgiao');
    fAnestesista.value = par('anestesista');
    fAuxiliar.value = par('auxiliar1');
  },
  { immediate: true },
);
const tempos = computed(() =>
  horaDoContrato(horas.inicio) && horaDoContrato(horas.fim)
    ? conferirTempos({
        inicio: horaDoContrato(horas.inicio) as string,
        fim: horaDoContrato(horas.fim) as string,
        inicioAnestesia: horaDoContrato(horas.inicioAnestesia),
        fimAnestesia: horaDoContrato(horas.fimAnestesia),
      })
    : null,
);
const porteDaDuracao = computed(() =>
  tempos.value?.duracaoMin ? porteSugerido(tempos.value.duracaoMin) : null,
);
const escolhasPorte = computed(() =>
  (['P', 'M', 'G'] as const).map((p) => ({ valor: p, rotulo: t(`cirurgia.portes.${p}`) })),
);
const escolhasPotencial = computed(() =>
  (['L', 'P', 'C'] as const).map((p) => ({ valor: p, rotulo: t(`cirurgia.potenciais.${p}`) })),
);
const escolhasTecnica = computed(() =>
  [0, 1, 2].map((v) => ({ valor: String(v), rotulo: t(`cirurgia.tecnicas.${v}`) })),
);
const caracteres = computed(() =>
  (opcoes.data.value?.caracteres ?? []).map((c) => ({ valor: String(c.codigo), rotulo: c.nome })),
);
const anestesias = computed(() =>
  comVazio(
    (opcoes.data.value?.anestesias ?? []).map((a) => ({ valor: String(a.codigo), rotulo: a.nome })),
    t('cirurgia.naoInformada'),
  ),
);
const especialidades = computed(() =>
  comVazio(
    (opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
  ),
);
const asas = computed(() =>
  comVazio(
    [1, 2, 3, 4, 5, 6].map((v) => ({ valor: String(v), rotulo: `ASA ${v}` })),
    t('cirurgia.naoInformada'),
  ),
);
const chave = ref(novaChave('registrar'));
const pronto = computed(
  () =>
    /^\d+$/.test(fReg.value) &&
    !!fData.value &&
    !!fSala.value &&
    !!fConvenio.value &&
    procedimento.value !== null &&
    !!profissionalDaEscolha(fCirurgiao.value) &&
    !!tempos.value &&
    tempos.value.problemas.length === 0,
);

async function registrar(): Promise<void> {
  if (!pronto.value || !procedimento.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  const h = (v: string) => horaDoContrato(v);
  const equipe: Record<string, { id: number; cod: number }> = {};
  for (const [f, v] of [
    ['cirurgiao', fCirurgiao.value],
    ['anestesista', fAnestesista.value],
    ['auxiliar1', fAuxiliar.value],
  ] as const) {
    const p = profissionalDaEscolha(v);
    if (p) equipe[f] = p;
  }
  try {
    const r = await registrarCirurgia(
      {
        agendamento: agendamento.value,
        reg: Number(fReg.value),
        data: fData.value,
        sala: Number(fSala.value),
        convenio: Number(fConvenio.value),
        porte: fPorte.value,
        potencialContaminacao: fPotencial.value,
        carater: Number(fCarater.value),
        tipoAnestesia: fAnestesia.value ? Number(fAnestesia.value) : 0,
        inicio: h(horas.inicio),
        fim: h(horas.fim),
        inicioAnestesia: h(horas.inicioAnestesia),
        fimAnestesia: h(horas.fimAnestesia),
        cid10: fCid.value.trim().toUpperCase() || null,
        pressao: fPressao.value.trim() || null,
        pulso: fPulso.value ? Number(fPulso.value) : null,
        supuracao: fSupuracao.value,
        usos: Object.fromEntries(
          USOS.map((u) => [
            u,
            {
              usado: usos.value[u].usado,
              descricao:
                usos.value[u].usado && usos.value[u].descricao.trim() ? usos.value[u].descricao.trim() : null,
            },
          ]),
        ),
        motivoExcecaoIncisao:
          agendamento.value === null && horas.incisao.trim() ? fMotivoExcecao.value.trim() || null : null,
        procedimentos: [
          {
            procedimento: procedimento.value.codigo,
            especialidade: fEspecialidade.value ? Number(fEspecialidade.value) : 0,
            tecnica: Number(fTecnica.value),
            equipe,
          },
        ],
        extensao: {
          entradaSala: h(horas.entradaSala),
          incisao: h(horas.incisao),
          saidaSala: h(horas.saidaSala),
          asa: fAsa.value ? Number(fAsa.value) : null,
          observacao: fObservacao.value.trim() || null,
        },
      },
      chave.value,
    );
    mensagem.value = r.mensagem;
    chave.value = novaChave('registrar');
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (e) {
    erro.value = e;
    chave.value = novaChave('registrar');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="registro-titulo" data-testid="tela-registro-cirurgia">
    <h1 id="registro-titulo">{{ t('cirurgia.registro.titulo') }}</h1>
    <p>{{ t('cirurgia.registro.texto') }}</p>
    <AvisoCirurgia :motivo="motivoRegistro" />
    <p class="acoes">
      <RouterLink to="/cirurgia/mapa">{{ t('cirurgia.mapa.titulo') }}</RouterLink>
    </p>

    <section v-if="podeRegistrar" class="painel" aria-labelledby="registro-ato" data-testid="form-registro">
      <h2 id="registro-ato">{{ t('cirurgia.registro.ato') }}</h2>
      <p v-if="origem.data.value" class="secundario" data-testid="registro-origem">
        {{
          t('cirurgia.registro.doAgendamento', {
            data: dataBr(origem.data.value.agendamento.data),
            hora: origem.data.value.agendamento.hora,
            paciente: origem.data.value.pacienteNome,
          })
        }}
      </p>
      <div class="filtros">
        <div class="campo">
          <label for="reg-reg">{{ t('cirurgia.registro.reg') }}</label>
          <input id="reg-reg" v-model="fReg" inputmode="numeric" data-testid="registro-reg" />
        </div>
        <div class="campo">
          <label for="reg-data">{{ t('cirurgia.data') }}</label>
          <input id="reg-data" v-model="fData" type="date" data-testid="registro-data" />
        </div>
        <SanteSelecao v-model="fSala" :rotulo="t('cirurgia.sala')" :opcoes="comVazio(salasPermitidas)" />
        <SanteSelecao v-model="fConvenio" :rotulo="t('cirurgia.convenio')" :opcoes="comVazio(convenios)" />
        <SanteSelecao v-model="fCarater" :rotulo="t('cirurgia.carater')" :opcoes="caracteres" />
        <SanteSelecao v-model="fAnestesia" :rotulo="t('cirurgia.anestesia')" :opcoes="anestesias" />
      </div>
      <fieldset class="filtros">
        <legend>{{ t('cirurgia.registro.tempos') }}</legend>
        <div v-for="c in CAMPOS_HORA" :key="c" class="campo">
          <label :for="`reg-${c}`">{{ t(`cirurgia.registro.${c}`) }}</label>
          <input
            :id="`reg-${c}`"
            v-model="horas[c]"
            inputmode="numeric"
            :placeholder="t('cirurgia.horaExemplo')"
            :data-testid="`registro-${c}`"
          />
        </div>
      </fieldset>
      <SanteAlerta v-for="p in tempos?.problemas ?? []" :key="p.campo" variante="alerta" :texto="p.texto" />
      <p v-if="tempos?.duracaoMin" class="secundario">
        {{ t('cirurgia.registro.duracao', { n: tempos.duracaoMin })
        }}<span v-if="porteDaDuracao">
          ·
          {{ t('cirurgia.registro.porteSugerido', { porte: t(`cirurgia.portes.${porteDaDuracao}`) }) }}</span
        >
      </p>
      <div class="filtros">
        <SanteSelecao v-model="fPorte" :rotulo="t('cirurgia.registro.porte')" :opcoes="escolhasPorte" />
        <SanteSelecao
          v-model="fPotencial"
          :rotulo="t('cirurgia.registro.potencial')"
          :opcoes="escolhasPotencial"
        />
        <SanteSelecao v-model="fAsa" :rotulo="t('cirurgia.registro.asa')" :opcoes="asas" />
      </div>
      <form class="filtros" role="search" @submit.prevent="procurarProcedimento">
        <div class="campo">
          <label for="reg-proc">{{ t('cirurgia.mapa.termoProcedimento') }}</label>
          <input id="reg-proc" v-model="termoProc" type="search" autocomplete="off" />
        </div>
        <SanteBotao tipo="submit" variante="secundario" :rotulo="t('cirurgia.mapa.buscarProcedimento')" />
      </form>
      <ul v-if="procs.length && !procedimento">
        <li v-for="p in procs" :key="p.codigo">
          <SanteBotao
            variante="texto"
            :rotulo="t('cirurgia.mapa.escolherProcedimento', { nome: p.nome, codigo: p.codigo })"
            @acionar="procedimento = p"
          />
        </li>
      </ul>
      <p v-if="procedimento" class="acoes">
        {{ t('cirurgia.mapa.procedimentoEscolhido', { nome: procedimento.nome }) }}
        <SanteBotao variante="texto" :rotulo="t('cirurgia.trocar')" @acionar="procedimento = null" />
      </p>
      <div class="filtros">
        <SanteSelecao
          v-model="fEspecialidade"
          :rotulo="t('cirurgia.especialidade')"
          :opcoes="especialidades"
        />
        <SanteSelecao v-model="fTecnica" :rotulo="t('cirurgia.registro.tecnica')" :opcoes="escolhasTecnica" />
        <SanteSelecao
          v-model="fCirurgiao"
          :rotulo="t('cirurgia.funcoes.cirurgiao')"
          :opcoes="comVazio(profissionais)"
        />
        <SanteSelecao
          v-model="fAnestesista"
          :rotulo="t('cirurgia.funcoes.anestesista')"
          :opcoes="comVazio(profissionais, t('cirurgia.semProfissional'))"
        />
        <SanteSelecao
          v-model="fAuxiliar"
          :rotulo="t('cirurgia.funcoes.auxiliar1')"
          :opcoes="comVazio(profissionais, t('cirurgia.semProfissional'))"
        />
      </div>
      <p class="secundario">{{ t('cirurgia.registro.tecnicaAConfirmar') }}</p>
      <fieldset class="filtros">
        <legend>{{ t('cirurgia.registro.usos') }}</legend>
        <div v-for="u in USOS" :key="u" class="campo">
          <label
            ><input v-model="usos[u].usado" type="checkbox" /> {{ t(`cirurgia.registro.uso.${u}`) }}</label
          >
          <input
            v-if="usos[u].usado"
            v-model="usos[u].descricao"
            maxlength="35"
            :aria-label="t('cirurgia.registro.usoDescricao', { uso: t(`cirurgia.registro.uso.${u}`) })"
          />
        </div>
        <label><input v-model="fSupuracao" type="checkbox" /> {{ t('cirurgia.registro.supuracao') }}</label>
      </fieldset>
      <div class="filtros">
        <div class="campo">
          <label for="reg-cid">{{ t('cirurgia.registro.cid') }}</label>
          <input id="reg-cid" v-model="fCid" maxlength="6" />
        </div>
        <div class="campo">
          <label for="reg-pressao">{{ t('cirurgia.registro.pressao') }}</label>
          <input
            id="reg-pressao"
            v-model="fPressao"
            maxlength="7"
            :placeholder="t('cirurgia.registro.pressaoExemplo')"
          />
        </div>
        <div class="campo">
          <label for="reg-pulso">{{ t('cirurgia.registro.pulso') }}</label>
          <input id="reg-pulso" v-model="fPulso" inputmode="numeric" maxlength="3" />
        </div>
      </div>
      <SanteCampoTexto v-model="fObservacao" :rotulo="t('cirurgia.observacao')" :max-bytes="400" multilinha />
      <SanteCampoTexto
        v-if="agendamento === null && horas.incisao.trim()"
        v-model="fMotivoExcecao"
        :rotulo="t('cirurgia.registro.motivoExcecaoIncisao')"
        :max-bytes="100"
        data-testid="registro-motivo-excecao"
      />
      <SanteBotao
        :rotulo="t('cirurgia.registro.registrar')"
        :desabilitado="!pronto || ocupado"
        data-testid="botao-registrar"
        @acionar="registrar"
      />
    </section>
    <p v-if="mensagem" role="status" data-testid="registro-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />

    <section class="painel" aria-labelledby="realizadas-titulo">
      <h2 id="realizadas-titulo">{{ t('cirurgia.registro.realizadas') }}</h2>
      <form
        class="filtros"
        role="search"
        data-testid="filtro-realizadas"
        @submit.prevent="filtro = { de, ate, reg: regBusca, sala: salaBusca }"
      >
        <div class="campo">
          <label for="realizadas-reg">{{ t('cirurgia.registro.reg') }}</label>
          <input id="realizadas-reg" v-model="regBusca" inputmode="numeric" data-testid="realizadas-reg" />
        </div>
        <SanteSelecao
          v-model="salaBusca"
          :rotulo="t('cirurgia.sala')"
          :opcoes="comVazio(salas, t('cirurgia.todasSalas'))"
        />
        <div class="campo">
          <label for="realizadas-de">{{ t('cirurgia.de') }}</label>
          <input id="realizadas-de" v-model="de" type="date" />
        </div>
        <div class="campo">
          <label for="realizadas-ate">{{ t('cirurgia.ate') }}</label>
          <input id="realizadas-ate" v-model="ate" type="date" />
        </div>
        <SanteBotao tipo="submit" :rotulo="t('cirurgia.filtrar')" />
      </form>
      <ErroCirurgia v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
      <template v-else>
        <p class="secundario" data-testid="resumo-ligacoes">
          {{ t('cirurgia.registro.resumo', lista.data.value.resumo) }}
        </p>
        <p v-if="lista.data.value.itens.length === 0">{{ t('cirurgia.nenhuma') }}</p>
        <table v-else class="tabela" data-testid="tabela-realizadas">
          <thead>
            <tr>
              <th scope="col">{{ t('cirurgia.data') }}</th>
              <th scope="col">{{ t('cirurgia.sala') }}</th>
              <th scope="col">{{ t('cirurgia.paciente') }}</th>
              <th scope="col">{{ t('cirurgia.procedimento') }}</th>
              <th scope="col">{{ t('cirurgia.registro.tempos') }}</th>
              <th scope="col">{{ t('cirurgia.registro.ligacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in lista.data.value.itens" :key="r.id">
              <td>{{ dataBr(r.data) }}</td>
              <td>{{ r.sala }}</td>
              <td>{{ r.paciente }}</td>
              <td>
                <span v-for="p in r.procedimentos" :key="p.procedimento.codigo">
                  {{ p.procedimento.nome }} · {{ p.equipe.map((e) => `${e.rotulo}: ${e.nome}`).join(', ') }}
                </span>
              </td>
              <td>
                {{ t('cirurgia.faixa', { de: r.inicio, ate: r.fim })
                }}<span v-if="r.extensao?.asa">
                  · {{ t('cirurgia.registro.asaN', { n: r.extensao.asa }) }}</span
                >
              </td>
              <td>
                {{
                  t(
                    r.ligacao.tipo === 'registro' && r.ligacao.agendamento === null
                      ? 'cirurgia.registro.ligacoes.registroSem'
                      : `cirurgia.registro.ligacoes.${r.ligacao.tipo}`,
                  )
                }}
                <template v-if="podeRevisar && !['registro', 'revisao'].includes(r.ligacao.tipo)">
                  <SanteBotao
                    v-for="c in r.ligacao.candidatos"
                    :key="c"
                    variante="texto"
                    :rotulo="t('cirurgia.registro.ligarA', { n: c })"
                    @acionar="revisar(r.id, c)"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('cirurgia.registro.semAgendamento')"
                    @acionar="revisar(r.id, null)"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
