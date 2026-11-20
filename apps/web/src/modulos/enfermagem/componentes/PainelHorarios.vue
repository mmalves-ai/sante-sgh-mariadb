<script setup lang="ts">
// Os horários de um paciente (últimas e próximas 12 horas) com a checagem, o histórico, o estorno e os eventos da
// infusão (ficha do M25, seção 7: checagem em tela e no tablet). Os horários lidos ficam no cache cifrado do aparelho
// (prazo do parâmetro da unidade): sem rede, a tela mostra os guardados e a checagem vai para a fila. A suspensão
// feita na prescrição chega pelo canal de avisos e a tela relê.
import { EVENTOS_INFUSAO, type HorarioEnfermagem, MOTIVOS_ESTORNO_CHECAGEM } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  conflitoDaRecusa,
  estoqueBaixadoDaRecusa,
  estornar,
  type DetalheDoHorario,
  type HorariosDoPaciente,
  lerHorario,
  lerHorariosDoPaciente,
  novaChave,
  registrarInfusao,
  semRede,
} from '../api-enfermagem.js';
import { guardar as guardarNoCofre, lerGuardado } from '../cofre-local.js';
import { usarChecagem } from '../usar-checagem.js';
import { usarAvisosEnfermagem, usarEnfermagem } from '../usar-enfermagem.js';
import ErroEnfermagem from './ErroEnfermagem.vue';
import EstadoHorario from './EstadoHorario.vue';
import FormChecagem from './FormChecagem.vue';

const props = defineProps<{ atendimento: number; pulseiraLida?: string | null }>();
const emit = defineEmits<{ carregado: [d: HorariosDoPaciente] }>();
const { t } = useI18n();
const { gravacao, pode, motivoDe, dono } = usarEnfermagem();
const podeChecar = pode('enfermagem.checarAdministracao');
const motivoChecar = motivoDe('enfermagem.checarAdministracao');
const podeEstornar = computed(
  () => gravacao.data.value?.operacoes['enfermagem.estornarChecagem']?.pode === true,
);
const prazo = computed(() => gravacao.data.value?.parametros.cacheHoras ?? 12);
const { online, pendentes, ultimo, enviando, enviarChecagem, enviarFila, ajustarRelogio } = usarChecagem(
  dono,
  prazo,
  () => {
    void carregar();
  },
);

const dados = ref<HorariosDoPaciente | null>(null);
const doCache = ref<string | null>(null);
const erroLeitura = ref<unknown>(null);
const vencido = ref(false);
const chaveCache = computed(() => `horarios:${props.atendimento}`);

async function carregar(): Promise<void> {
  erroLeitura.value = null;
  try {
    const d = await lerHorariosDoPaciente(props.atendimento);
    dados.value = d;
    doCache.value = null;
    vencido.value = false;
    ajustarRelogio(d.agora);
    emit('carregado', d);
    if (dono.value) await guardarNoCofre(dono.value, chaveCache.value, d);
  } catch (x) {
    if (semRede(x) && dono.value) {
      const g = await lerGuardado<HorariosDoPaciente>(dono.value, chaveCache.value, prazo.value);
      if (g) {
        dados.value = g;
        doCache.value = g.agora;
        emit('carregado', g);
        return;
      }
      vencido.value = true;
    }
    erroLeitura.value = x;
  }
}
onMounted(carregar);
watch(() => props.atendimento, carregar);
usarAvisosEnfermagem(() => {
  if (online.value) void carregar();
});

const escolhido = ref<HorarioEnfermagem | null>(null);
const aberto = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<string[]>([]);
const conflito = ref<number | null>(null);
function checarHorario(h: HorarioEnfermagem): void {
  escolhido.value = h;
  erro.value = null;
  aberto.value = true;
}
async function registrar(corpo: Record<string, unknown>): Promise<void> {
  const h = escolhido.value;
  if (!h) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  conflito.value = null;
  try {
    const r = await enviarChecagem(h, corpo, `${h.descricao} · ${h.previsto.slice(11, 16)}`);
    if (r.tipo === 'gravado') {
      mensagem.value = r.resultado.mensagem || t('enfermagem.checagem.checado');
      avisos.value = [...r.resultado.avisos];
    } else mensagem.value = t('enfermagem.checagem.guardadoSemRede');
    aberto.value = false;
    if (online.value) await carregar();
  } catch (x) {
    erro.value = x;
    conflito.value = conflitoDaRecusa(x);
    if (conflito.value) {
      aberto.value = false;
      await carregar();
    }
  } finally {
    ocupado.value = false;
  }
}
async function sincronizarAgora(): Promise<void> {
  erro.value = null;
  try {
    const r = await enviarFila();
    if (r) await carregar();
  } catch (x) {
    erro.value = x;
  }
}

// Histórico, estorno e infusão.
const detalhe = ref<DetalheDoHorario | null>(null);
const verDetalhe = ref(false);
async function historico(h: HorarioEnfermagem): Promise<void> {
  erro.value = null;
  try {
    detalhe.value = await lerHorario(h.id);
    estoqueBaixado.value = null;
    verDetalhe.value = true;
  } catch (x) {
    erro.value = x;
  }
}
// W1-08: o estorno é fato novo com o motivo da lista; a dose que já baixou estoque é recusada pelo servidor, a tela
// avisa e oferece a devolução na farmácia ou o estorno com a devolução pendente.
const justificativa = ref('');
const motivoEstorno = ref<string>('');
const opcoesMotivoEstorno = computed(() =>
  MOTIVOS_ESTORNO_CHECAGEM.map((valor) => ({
    valor,
    rotulo: t(`enfermagem.checagem.estornoMotivos.${valor}`),
  })),
);
const estoqueBaixado = ref<string | null>(null);
async function estornarHorario(h: HorarioEnfermagem, devolucaoPendente = false): Promise<void> {
  erro.value = null;
  try {
    const r = await estornar(
      h.id,
      { motivo: motivoEstorno.value, justificativa: justificativa.value.trim(), devolucaoPendente },
      novaChave(`estorno-${h.id}`),
    );
    mensagem.value = r.mensagem;
    justificativa.value = '';
    motivoEstorno.value = '';
    estoqueBaixado.value = null;
    verDetalhe.value = false;
    await carregar();
  } catch (x) {
    const baixa = estoqueBaixadoDaRecusa(x);
    if (baixa !== null) estoqueBaixado.value = baixa || t('enfermagem.checagem.estoqueBaixado');
    else erro.value = x;
  }
}
const eventoInf = ref('inicio');
const velocidade = ref('');
const volume = ref('');
const opcoesInfusao = computed(() =>
  Object.entries(EVENTOS_INFUSAO).map(([valor, rotulo]) => ({ valor, rotulo })),
);
async function infusao(h: HorarioEnfermagem): Promise<void> {
  erro.value = null;
  try {
    const r = await registrarInfusao(
      h.id,
      {
        evento: eventoInf.value,
        velocidadeMlH: velocidade.value ? Number(velocidade.value) : null,
        volumeInfundidoMl: volume.value ? Number(volume.value) : null,
      },
      novaChave(`inf-${h.id}`),
    );
    mensagem.value = r.mensagem;
    detalhe.value = await lerHorario(h.id);
  } catch (x) {
    erro.value = x;
  }
}
const hora = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const checavel = (h: HorarioEnfermagem) => ['pendente', 'atrasada', 'omitida'].includes(h.estado);
</script>

<template>
  <div class="painel-horarios" data-testid="painel-horarios">
    <p v-if="!online" class="faixa-rede" role="status" data-testid="sem-rede">
      {{ t('enfermagem.comum.semRede') }}
    </p>
    <p v-if="pendentes > 0" role="status" data-testid="pendentes-aparelho">
      {{ t('enfermagem.comum.pendentesNoAparelho', { n: pendentes }) }}
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.comum.enviarAgora')"
        :desabilitado="!online || enviando"
        data-testid="enviar-fila"
        @acionar="sincronizarAgora"
      />
    </p>
    <p v-if="ultimo" role="status" data-testid="resultado-sincronizacao">
      {{
        t('enfermagem.comum.enviado', {
          ok: ultimo.resultados.filter((r) => r.ok).length,
          conflitos: ultimo.conflitos,
        })
      }}
      <RouterLink v-if="ultimo.conflitos > 0" to="/enfermagem/conflitos">{{
        t('enfermagem.comum.abrirConflitos')
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="motivoChecar" variante="aviso" :texto="motivoChecar" />
    <p v-if="mensagem" role="status" data-testid="chk-mensagem">{{ mensagem }}</p>
    <ul v-if="avisos.length" class="secundario">
      <li v-for="a in avisos" :key="a">{{ a }}</li>
    </ul>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <p v-if="conflito" role="alert">
      <RouterLink to="/enfermagem/conflitos" data-testid="chk-conflito">{{
        t('enfermagem.comum.abrirConflitos')
      }}</RouterLink>
    </p>
    <p v-if="vencido" role="alert">{{ t('enfermagem.beira.cacheVencido') }}</p>
    <ErroEnfermagem v-if="erroLeitura && !dados" :erro="erroLeitura" />
    <p v-else-if="!dados" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <template v-else>
      <h2 data-testid="painel-paciente">
        {{ dados.paciente.nome }} ·
        {{
          dados.paciente.leito
            ? t('enfermagem.comum.leito', { leito: dados.paciente.leito })
            : t('enfermagem.comum.semLeito')
        }}
        ·
        {{
          t('enfermagem.comum.atendimento', { numero: dados.paciente.numero ?? dados.paciente.atendimento })
        }}
      </h2>
      <p v-if="dados.paciente.alergia" class="alerta" role="note">{{ t('enfermagem.comum.alergia') }}</p>
      <p v-if="doCache" class="secundario">
        {{ t('enfermagem.beira.guardadosEm', { hora: hora(doCache) }) }}
      </p>
      <p v-if="dados.horarios.length === 0">{{ t('enfermagem.checagem.vazio') }}</p>
      <div v-else class="rolagem">
        <table class="grade">
          <thead>
            <tr>
              <th scope="col">{{ t('enfermagem.comum.previsto') }}</th>
              <th scope="col">{{ t('enfermagem.comum.item') }}</th>
              <th scope="col">{{ t('enfermagem.comum.situacao') }}</th>
              <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in dados.horarios" :key="h.id" :data-testid="`ph-${h.id}`" :data-estado="h.estado">
              <td>{{ hora(h.previsto) }}</td>
              <td>
                {{ h.descricao }}
                <span v-if="h.dose !== null"> · {{ h.dose }} {{ h.unidadeDose ?? '' }}</span>
                <strong v-if="h.altaVigilancia || h.hemocomponente" class="alerta">
                  ·
                  {{
                    h.hemocomponente
                      ? t('enfermagem.comum.hemocomponente')
                      : t('enfermagem.comum.altaVigilancia')
                  }}
                </strong>
              </td>
              <td><EstadoHorario :estado="h.estado" /></td>
              <td class="acoes">
                <SanteBotao
                  v-if="checavel(h)"
                  :rotulo="t('enfermagem.turno.checar')"
                  :desabilitado="!podeChecar"
                  :data-testid="`ph-checar-${h.id}`"
                  @acionar="checarHorario(h)"
                />
                <SanteBotao
                  v-if="online"
                  variante="texto"
                  :rotulo="t('enfermagem.checagem.verHistorico')"
                  :data-testid="`ph-historico-${h.id}`"
                  @acionar="historico(h)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <SanteDialogo v-model:visivel="aberto" :titulo="t('enfermagem.checagem.titulo')" largura="40rem">
      <FormChecagem
        v-if="escolhido"
        :key="escolhido.id"
        :horario="escolhido"
        :parametros="gravacao.data.value?.parametros ?? null"
        :pulseira-lida="pulseiraLida ?? null"
        :ocupado="ocupado"
        :pode-checar="podeChecar"
        :motivo="motivoChecar"
        @enviar="registrar"
      />
      <ErroEnfermagem v-if="erro && aberto" :erro="erro" />
    </SanteDialogo>

    <SanteDialogo v-model:visivel="verDetalhe" :titulo="t('enfermagem.checagem.historico')" largura="44rem">
      <template v-if="detalhe">
        <p>
          <strong>{{ detalhe.horario.descricao }}</strong> · {{ hora(detalhe.horario.previsto) }} ·
          <EstadoHorario :estado="detalhe.horario.estado" />
        </p>
        <ol class="historico" data-testid="historico-horario">
          <li v-for="(e, k) in detalhe.historico" :key="k">
            {{ hora(e.quando) }} · {{ e.rotulo }}<span v-if="e.profissional"> · {{ e.profissional }}</span>
            <span v-if="e.detalhe" class="secundario"> · {{ e.detalhe }}</span>
          </li>
        </ol>
        <template v-if="detalhe.horario.infusao">
          <h3>{{ t('enfermagem.checagem.infusao') }}</h3>
          <ul>
            <li v-for="i in detalhe.infusao" :key="i.id">
              {{ hora(i.horaReal) }} · {{ EVENTOS_INFUSAO[i.evento] }}
              <span v-if="i.velocidadeMlH !== null">
                · {{ t('enfermagem.checagem.velocidadeValor', { v: i.velocidadeMlH }) }}</span
              >
              <span v-if="i.volumeInfundidoMl !== null">
                · {{ t('enfermagem.checagem.volumeValor', { v: i.volumeInfundidoMl }) }}</span
              >
            </li>
          </ul>
          <div class="barra">
            <SanteSelecao
              v-model="eventoInf"
              :rotulo="t('enfermagem.checagem.eventoInfusao')"
              :opcoes="opcoesInfusao"
            />
            <span class="campo">
              <label for="inf-vel">{{ t('enfermagem.checagem.velocidade') }}</label>
              <input id="inf-vel" v-model="velocidade" inputmode="decimal" />
            </span>
            <span class="campo">
              <label for="inf-vol">{{ t('enfermagem.checagem.volume') }}</label>
              <input id="inf-vol" v-model="volume" inputmode="decimal" />
            </span>
            <SanteBotao
              :rotulo="t('enfermagem.checagem.registrarInfusao')"
              :desabilitado="!podeChecar"
              @acionar="infusao(detalhe.horario)"
            />
          </div>
        </template>
        <template v-if="['administrada', 'naoAdministrada'].includes(detalhe.horario.estado) && podeEstornar">
          <SanteSelecao
            v-model="motivoEstorno"
            :rotulo="t('enfermagem.checagem.estornoMotivo')"
            :opcoes="opcoesMotivoEstorno"
            data-testid="estorno-motivo"
          />
          <span class="campo">
            <label for="est-just">{{ t('enfermagem.checagem.estornoJustificativa') }}</label>
            <input
              id="est-just"
              v-model="justificativa"
              maxlength="200"
              data-testid="estorno-justificativa"
            />
          </span>
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('enfermagem.checagem.estornar')"
            :confirmacao="t('enfermagem.checagem.estornoPergunta')"
            :desabilitado="justificativa.trim().length < 10 || !motivoEstorno"
            data-testid="estornar"
            @acionar="estornarHorario(detalhe.horario)"
          />
          <template v-if="estoqueBaixado">
            <SanteAlerta variante="aviso" :texto="estoqueBaixado" data-testid="estorno-estoque-baixado" />
            <div class="acoes">
              <RouterLink to="/farmacia/devolucoes" data-testid="estorno-devolver-dose">{{
                t('enfermagem.checagem.devolverDose')
              }}</RouterLink>
              <SanteBotao
                variante="destrutivo"
                :rotulo="t('enfermagem.checagem.estornarComPendencia')"
                :confirmacao="t('enfermagem.checagem.estornarComPendenciaPergunta')"
                data-testid="estornar-com-pendencia"
                @acionar="estornarHorario(detalhe.horario, true)"
              />
            </div>
          </template>
        </template>
        <ErroEnfermagem v-if="erro && verDetalhe" :erro="erro" />
      </template>
    </SanteDialogo>
  </div>
</template>

<style src="../telas/estilo-enfermagem.css"></style>
<style scoped>
.painel-horarios {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-1);
  flex-wrap: wrap;
}
.historico {
  padding-left: var(--sgh-espaco-3);
}
</style>
