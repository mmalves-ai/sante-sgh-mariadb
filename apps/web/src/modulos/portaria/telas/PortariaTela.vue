<script setup lang="ts">
// Portaria (M50, etapa 5; item `Hotelaria e apoio > Portaria e visitantes > Cadastro de visitantes e crachá`;
// `hotelaria.visita.ler` / `.registrar`): o porteiro busca o paciente pelo nome (o paciente com sigilo de presença não
// aparece; o leito só aparece com a visita permitida; o motivo de um bloqueio nunca), escolhe ou cadastra o visitante
// (cadastro mínimo com o documento e a foto da webcam), confere a visita e registra a entrada; o crachá sai com a
// validade, para imprimir na impressora comum ou na térmica (ZPL). A exceção (fora do horário, acima do limite, idade)
// é do supervisor, com o motivo. As visitas em curso, com a saída e a reimpressão do crachá.
import type { CrachaVisita, PacientePortaria, TipoDocumentoVisitante, VisitanteLido } from '@sgh/contratos';
import { TIPO_VISITADO_PACIENTE, TIPOS_DOCUMENTO_VISITANTE } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AvaliacaoPortaria,
  avaliarVisitaPortaria,
  buscarPacientesPortaria,
  buscarVisitantes,
  lerAcompanhamento,
  lerCracha,
  lerPainelPortaria,
  registrarSaida,
  registrarVisita,
  registrarVisitante,
} from '../api-portaria.js';
import CapturaFoto from '../componentes/CapturaFoto.vue';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['portaria', 'painel'], queryFn: () => lerPainelPortaria() });
const p = computed(() => painel.data.value);
const pode = (op: string) => p.value?.gravacao.operacoes[op]?.pode === true;
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const erro = ref<unknown>(null);
const mensagem = ref('');
const ocupado = ref(false);

// ── Destino ──
const tipoDestino = ref<'paciente' | 'outro'>('paciente');
const opcoesDestino = computed(() => [
  { valor: 'paciente' as const, rotulo: t('portaria.destino.paciente') },
  { valor: 'outro' as const, rotulo: t('portaria.destino.outro') },
]);
const busca = ref('');
const pacientes = ref<PacientePortaria[] | null>(null);
const paciente = ref<PacientePortaria | null>(null);
const tipoVisitado = ref<number | null>(null);
const local = ref('');
const opcoesVisitado = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.dominios.tiposVisitado ?? [])
    .filter((x) => x.codigo !== TIPO_VISITADO_PACIENTE)
    .map((x) => ({ valor: x.codigo, rotulo: x.nome })),
]);
async function buscarPaciente(): Promise<void> {
  erro.value = null;
  paciente.value = null;
  try {
    pacientes.value = await buscarPacientesPortaria(busca.value.trim());
  } catch (x) {
    erro.value = x;
    pacientes.value = null;
  }
}

// ── Visitante ──
const buscaVisitante = ref('');
const tipoDocBusca = ref<TipoDocumentoVisitante | ''>('');
const visitantes = ref<VisitanteLido[] | null>(null);
const visitante = ref<VisitanteLido | null>(null);
const opcoesDocumento = computed(() =>
  TIPOS_DOCUMENTO_VISITANTE.map((d) => ({ valor: d, rotulo: t(`portaria.documentos.${d}`) })),
);
async function buscarVisitante(): Promise<void> {
  erro.value = null;
  try {
    visitantes.value = tipoDocBusca.value
      ? await buscarVisitantes({ tipo: tipoDocBusca.value, documento: buscaVisitante.value })
      : await buscarVisitantes({ busca: buscaVisitante.value });
  } catch (x) {
    erro.value = x;
    visitantes.value = null;
  }
}
// O acompanhante vigente com direito legal: a entrada sai do próprio visitante (o paciente com sigilo de presença não
// aparece na busca, mas o acompanhante dele entra).
const acompanha = ref<PacientePortaria | null>(null);
watch(visitante, async (v) => {
  acompanha.value = null;
  if (!v) return;
  try {
    acompanha.value = (await lerAcompanhamento(v.id)).paciente;
  } catch (x) {
    erro.value = x;
  }
});
function entrarComoAcompanhante(): void {
  if (!acompanha.value) return;
  tipoDestino.value = 'paciente';
  paciente.value = acompanha.value;
}
const cadastrando = ref(false);
const novo = ref({
  nome: '',
  tipoDocumento: 'cpf' as TipoDocumentoVisitante,
  documento: '',
  nascimento: '',
  telefone: '',
  tipoVisitante: 6 as number | null,
});
const foto = ref<{ tipo: 'image/jpeg'; base64: string } | null>(null);
const opcoesTipoVisitante = computed(() =>
  (p.value?.dominios.tiposVisitante ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.codigo as number | null, rotulo: x.nome })),
);
const prontoParaCadastrar = computed(
  () =>
    novo.value.nome.trim().length >= 3 &&
    novo.value.documento.trim().length >= 3 &&
    novo.value.tipoVisitante !== null,
);
async function cadastrar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await registrarVisitante({
      nome: novo.value.nome,
      tipoDocumento: novo.value.tipoDocumento,
      documento: novo.value.documento,
      nascimento: novo.value.nascimento || null,
      telefone: novo.value.telefone || null,
      tipoVisitante: novo.value.tipoVisitante,
      foto: foto.value,
    });
    mensagem.value = r.mensagem;
    const [v] = await buscarVisitantes({ tipo: novo.value.tipoDocumento, documento: novo.value.documento });
    visitante.value = v ?? null;
    cadastrando.value = false;
    foto.value = null;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Entrada ──
const identificacao = ref<number | null>(2);
const opcoesIdentificacao = computed(() =>
  (p.value?.dominios.identificacoes ?? []).map((i) => ({
    valor: i.codigo as number | null,
    rotulo: i.disponivel ? i.nome : t('portaria.entrada.naoLiberada', { nome: i.nome }),
    desabilitada: !i.disponivel,
  })),
);
const avaliacao = ref<AvaliacaoPortaria | null>(null);
watch([paciente, visitante, identificacao], async () => {
  avaliacao.value = null;
  if (tipoDestino.value !== 'paciente' || !paciente.value || !visitante.value) return;
  try {
    avaliacao.value = await avaliarVisitaPortaria(
      paciente.value.internacao,
      visitante.value.id,
      identificacao.value,
    );
  } catch (x) {
    erro.value = x;
  }
});
const excecao = ref('');
const podeExcecao = computed(() => pode('regrar') && avaliacao.value?.excepcionavel === true);
const prontoParaEntrar = computed(() => {
  if (!visitante.value || identificacao.value === null || !pode('registrar')) return false;
  if (tipoDestino.value === 'outro') return tipoVisitado.value !== null && local.value.trim().length >= 2;
  if (!paciente.value || !avaliacao.value) return false;
  return avaliacao.value.permitida || (podeExcecao.value && excecao.value.trim().length >= 10);
});
const cracha = ref<CrachaVisita | null>(null);
const dialogoCracha = ref(false);
async function entrar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await registrarVisita({
      visitante: visitante.value!.id,
      destino:
        tipoDestino.value === 'paciente'
          ? { tipo: 'paciente', internacao: paciente.value!.internacao }
          : { tipo: 'outro', tipoVisitado: tipoVisitado.value, local: local.value },
      identificacao: identificacao.value,
      excecao: avaliacao.value?.permitida === false && excecao.value.trim() ? excecao.value.trim() : null,
    });
    mensagem.value = r.mensagem;
    cracha.value = r.cracha ?? null;
    dialogoCracha.value = cracha.value !== null;
    visitante.value = null;
    paciente.value = null;
    pacientes.value = null;
    excecao.value = '';
    await cliente.invalidateQueries({ queryKey: ['portaria', 'painel'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function saida(id: number): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (await registrarSaida(id)).mensagem;
    await cliente.invalidateQueries({ queryKey: ['portaria', 'painel'] });
  } catch (x) {
    erro.value = x;
  }
}
async function reimprimir(id: number): Promise<void> {
  erro.value = null;
  try {
    cracha.value = await lerCracha(id);
    dialogoCracha.value = true;
  } catch (x) {
    erro.value = x;
  }
}
function imprimir(): void {
  window.print();
}
function baixarZpl(): void {
  if (!cracha.value) return;
  const url = URL.createObjectURL(new Blob([cracha.value.zpl], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cracha-${cracha.value.codigo}.zpl`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="pt-titulo" data-testid="tela-portaria">
    <h1 id="pt-titulo">{{ t('portaria.titulo') }}</h1>
    <p>{{ t('portaria.subtitulo') }}</p>
    <nav class="barra" :aria-label="t('portaria.navegacao')">
      <RouterLink v-if="pode('regrar')" to="/portaria/regras" data-testid="pt-link-regras">{{
        t('portaria.links.regras')
      }}</RouterLink>
      <RouterLink to="/portaria/acompanhantes" data-testid="pt-link-acompanhantes">{{
        t('portaria.links.acompanhantes')
      }}</RouterLink>
      <RouterLink v-if="pode('contatos')" to="/portaria/contatos" data-testid="pt-link-contatos">{{
        t('portaria.links.contatos')
      }}</RouterLink>
      <RouterLink v-if="pode('terminal')" to="/portaria/terminais">{{
        t('portaria.links.terminais')
      }}</RouterLink>
    </nav>
    <p v-if="painel.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="painel.error.value" :erro="painel.error.value" />
    <template v-else-if="p">
      <SanteAlerta
        v-if="!p.gravacao.ligada"
        variante="info"
        :texto="p.gravacao.motivo ?? t('portaria.desligada')"
        data-testid="pt-desligada"
      />
      <p v-if="mensagem" role="status" data-testid="pt-mensagem">{{ mensagem }}</p>
      <ErroPortaria v-if="erro" :erro="erro" />

      <section class="cartao" aria-labelledby="pt-destino">
        <h2 id="pt-destino">{{ t('portaria.destino.titulo') }}</h2>
        <SanteOpcoes
          v-model="tipoDestino"
          :legenda="t('portaria.destino.legenda')"
          :opcoes="opcoesDestino"
          nome="pt-destino"
        />
        <template v-if="tipoDestino === 'paciente'">
          <form class="barra" @submit.prevent="buscarPaciente">
            <span class="campo">
              <label for="pt-busca">{{ t('portaria.destino.busca') }}</label>
              <input id="pt-busca" v-model="busca" maxlength="70" autocomplete="off" data-testid="pt-busca" />
            </span>
            <SanteBotao
              tipo="submit"
              :rotulo="t('portaria.destino.buscar')"
              :desabilitado="busca.trim().length < 3"
              data-testid="pt-buscar"
            />
          </form>
          <p v-if="pacientes && pacientes.length === 0" data-testid="pt-sem-paciente">
            {{ t('portaria.destino.nenhum') }}
          </p>
          <div v-else-if="pacientes" class="rolagem">
            <table class="grade" data-testid="pt-pacientes">
              <thead>
                <tr>
                  <th scope="col">{{ t('portaria.destino.colPaciente') }}</th>
                  <th scope="col">{{ t('portaria.destino.colUnidade') }}</th>
                  <th scope="col">{{ t('portaria.destino.colLeito') }}</th>
                  <th scope="col">{{ t('portaria.destino.colSituacao') }}</th>
                  <th scope="col">{{ t('portaria.acoes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in pacientes" :key="x.internacao" :data-testid="`pt-paciente-${x.internacao}`">
                  <td>{{ x.nome }}</td>
                  <td>{{ x.unidadeNome }}</td>
                  <td>{{ x.leito ?? '—' }}</td>
                  <td>
                    <strong :class="x.permitida ? 'ok' : 'alerta'">{{
                      x.permitida ? t('portaria.destino.permitida') : t('portaria.destino.naoPermitida')
                    }}</strong>
                    <span class="secundario"> · {{ x.mensagem }}</span>
                    <span v-if="x.orientacao" class="secundario"> · {{ x.orientacao }}</span>
                    <span class="secundario">
                      ·
                      {{
                        t('portaria.destino.horario', {
                          horario: x.horario,
                          agora: x.visitantesAgora,
                          limite: x.limite,
                        })
                      }}</span
                    >
                  </td>
                  <td>
                    <SanteBotao
                      variante="texto"
                      :rotulo="t('portaria.destino.escolher')"
                      :data-testid="`pt-escolher-${x.internacao}`"
                      @acionar="paciente = x"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="paciente" data-testid="pt-paciente-escolhido">
            {{ t('portaria.destino.escolhido', { nome: paciente.nome, unidade: paciente.unidadeNome }) }}
          </p>
        </template>
        <div v-else class="campos">
          <SanteSelecao
            v-model="tipoVisitado"
            :rotulo="t('portaria.destino.tipoVisitado')"
            :opcoes="opcoesVisitado"
            data-testid="pt-tipo-visitado"
          />
          <span class="campo">
            <label for="pt-local">{{ t('portaria.destino.local') }}</label>
            <input id="pt-local" v-model="local" maxlength="60" data-testid="pt-local" />
          </span>
        </div>
      </section>

      <section class="cartao" aria-labelledby="pt-visitante">
        <h2 id="pt-visitante">{{ t('portaria.visitante.titulo') }}</h2>
        <form class="barra" @submit.prevent="buscarVisitante">
          <SanteSelecao
            v-model="tipoDocBusca"
            :rotulo="t('portaria.visitante.buscarPor')"
            :opcoes="[{ valor: '', rotulo: t('portaria.visitante.porNome') }, ...opcoesDocumento]"
            data-testid="pt-busca-tipo"
          />
          <span class="campo">
            <label for="pt-busca-visitante">{{
              tipoDocBusca ? t('portaria.visitante.documento') : t('portaria.visitante.nome')
            }}</label>
            <input
              id="pt-busca-visitante"
              v-model="buscaVisitante"
              maxlength="70"
              autocomplete="off"
              data-testid="pt-busca-visitante"
            />
          </span>
          <SanteBotao
            tipo="submit"
            :rotulo="t('portaria.visitante.buscar')"
            :desabilitado="buscaVisitante.trim().length < 3"
            data-testid="pt-buscar-visitante"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portaria.visitante.novo')"
            :desabilitado="!pode('registrar')"
            data-testid="pt-novo-visitante"
            @acionar="cadastrando = true"
          />
        </form>
        <p v-if="visitantes && visitantes.length === 0">{{ t('portaria.visitante.nenhum') }}</p>
        <ul v-else-if="visitantes" class="lista" data-testid="pt-visitantes">
          <li v-for="v in visitantes" :key="v.id">
            {{ v.nome }} · {{ t(`portaria.documentos.${v.tipoDocumento}`) }} {{ v.documentoMascarado }}
            <span v-if="v.temFoto" class="secundario"> · {{ t('portaria.visitante.comFoto') }}</span>
            <SanteBotao
              variante="texto"
              :rotulo="t('portaria.visitante.escolher')"
              :data-testid="`pt-escolher-visitante-${v.id}`"
              @acionar="visitante = v"
            />
          </li>
        </ul>
        <p v-if="visitante && acompanha" data-testid="pt-acompanha">
          {{
            t('portaria.visitante.acompanhanteDe', { nome: acompanha.nome, unidade: acompanha.unidadeNome })
          }}
          <SanteBotao
            variante="secundario"
            :rotulo="t('portaria.visitante.entrarComoAcompanhante')"
            data-testid="pt-entrar-acompanhante"
            @acionar="entrarComoAcompanhante"
          />
        </p>
        <form v-if="cadastrando" class="registro" data-testid="pt-form-visitante" @submit.prevent="cadastrar">
          <h3>{{ t('portaria.visitante.cadastro') }}</h3>
          <p class="secundario">{{ t('portaria.visitante.minimo', { dias: p.retencaoDias }) }}</p>
          <div class="campos">
            <span class="campo">
              <label for="pt-nome">{{ t('portaria.visitante.nome') }}</label>
              <input id="pt-nome" v-model="novo.nome" maxlength="70" data-testid="pt-nome" />
            </span>
            <SanteSelecao
              v-model="novo.tipoDocumento"
              :rotulo="t('portaria.visitante.tipoDocumento')"
              :opcoes="opcoesDocumento"
              data-testid="pt-tipo-documento"
            />
            <span class="campo">
              <label for="pt-documento">{{ t('portaria.visitante.documento') }}</label>
              <input id="pt-documento" v-model="novo.documento" maxlength="20" data-testid="pt-documento" />
            </span>
            <span class="campo">
              <label for="pt-nascimento">{{ t('portaria.visitante.nascimento') }}</label>
              <input id="pt-nascimento" v-model="novo.nascimento" type="date" data-testid="pt-nascimento" />
            </span>
            <span class="campo">
              <label for="pt-telefone">{{ t('portaria.visitante.telefone') }}</label>
              <input id="pt-telefone" v-model="novo.telefone" inputmode="tel" maxlength="15" />
            </span>
            <SanteSelecao
              v-model="novo.tipoVisitante"
              :rotulo="t('portaria.visitante.tipo')"
              :opcoes="opcoesTipoVisitante"
              data-testid="pt-tipo-visitante"
            />
          </div>
          <CapturaFoto v-model="foto" />
          <div class="barra">
            <SanteBotao
              tipo="submit"
              :rotulo="t('portaria.visitante.gravar')"
              :desabilitado="!prontoParaCadastrar || ocupado"
              data-testid="pt-gravar-visitante"
            />
            <SanteBotao variante="texto" :rotulo="t('portaria.cancelar')" @acionar="cadastrando = false" />
          </div>
        </form>
        <p v-if="visitante" data-testid="pt-visitante-escolhido">
          {{ t('portaria.visitante.escolhido', { nome: visitante.nome }) }}
        </p>
      </section>

      <section class="cartao" aria-labelledby="pt-entrada">
        <h2 id="pt-entrada">{{ t('portaria.entrada.titulo') }}</h2>
        <SanteSelecao
          v-model="identificacao"
          :rotulo="t('portaria.entrada.identificacao')"
          :opcoes="opcoesIdentificacao"
          data-testid="pt-identificacao"
        />
        <p v-if="!p.biometriaLigada" class="secundario">{{ t('portaria.entrada.semBiometria') }}</p>
        <div v-if="avaliacao" data-testid="pt-avaliacao">
          <SanteAlerta
            :variante="avaliacao.permitida ? 'info' : 'alerta'"
            :texto="
              avaliacao.permitida
                ? avaliacao.papel === 'acompanhante'
                  ? t('portaria.entrada.acompanhante')
                  : t('portaria.entrada.permitida', { leito: avaliacao.leito ?? '' })
                : avaliacao.mensagem
            "
          />
          <p v-if="avaliacao.orientacao" data-testid="pt-orientacao">{{ avaliacao.orientacao }}</p>
          <span v-if="podeExcecao" class="campo">
            <label for="pt-excecao">{{ t('portaria.entrada.excecao') }}</label>
            <input id="pt-excecao" v-model="excecao" maxlength="200" data-testid="pt-excecao" />
          </span>
          <p v-else-if="!avaliacao.permitida && avaliacao.excepcionavel" class="secundario">
            {{ t('portaria.entrada.pecaSupervisor') }}
          </p>
        </div>
        <SanteBotao
          :rotulo="t('portaria.entrada.registrar')"
          :desabilitado="!prontoParaEntrar || ocupado"
          data-testid="pt-registrar"
          @acionar="entrar"
        />
      </section>

      <section aria-labelledby="pt-abertas">
        <h2 id="pt-abertas">{{ t('portaria.abertas.titulo') }}</h2>
        <p v-if="p.abertas.length === 0">{{ t('portaria.abertas.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="pt-abertas">
            <thead>
              <tr>
                <th scope="col">{{ t('portaria.abertas.visitante') }}</th>
                <th scope="col">{{ t('portaria.abertas.destino') }}</th>
                <th scope="col">{{ t('portaria.abertas.entrada') }}</th>
                <th scope="col">{{ t('portaria.abertas.validade') }}</th>
                <th scope="col">{{ t('portaria.abertas.cracha') }}</th>
                <th scope="col">{{ t('portaria.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in p.abertas" :key="v.id" :data-testid="`pt-aberta-${v.id}`">
                <td>
                  {{ v.visitante.nome }}
                  <span v-if="v.papel === 'acompanhante'" class="secundario">
                    · {{ t('portaria.abertas.acompanhante') }}</span
                  >
                </td>
                <td>
                  {{
                    v.destino.tipo === 'paciente'
                      ? `${v.destino.paciente} · ${v.destino.unidade} · ${v.destino.leito ?? ''}`
                      : v.destino.local
                  }}
                </td>
                <td>{{ hora(v.entrada) }}</td>
                <td :class="{ alerta: v.vencida }">
                  {{ hora(v.validoAte)
                  }}<strong v-if="v.vencida"> · {{ t('portaria.abertas.vencida') }}</strong>
                </td>
                <td>{{ v.cracha }}</td>
                <td class="barra">
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portaria.abertas.saida')"
                    :desabilitado="!pode('registrar')"
                    :data-testid="`pt-saida-${v.id}`"
                    @acionar="saida(v.id)"
                  />
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portaria.abertas.reimprimir')"
                    :desabilitado="!pode('registrar')"
                    @acionar="reimprimir(v.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <SanteDialogo v-model:visivel="dialogoCracha" :titulo="t('portaria.cracha.titulo')">
      <div v-if="cracha" class="cracha" data-testid="pt-cracha">
        <p class="cracha__nome">{{ cracha.visitante }}</p>
        <p>{{ cracha.destino }}</p>
        <p data-testid="pt-cracha-validade">
          {{ t('portaria.cracha.validade', { quando: hora(cracha.validoAte) }) }}
        </p>
        <p class="cracha__codigo" data-testid="pt-cracha-codigo">{{ cracha.codigo }}</p>
        <div class="barra nao-imprimir">
          <SanteBotao
            :rotulo="t('portaria.cracha.imprimir')"
            data-testid="pt-cracha-imprimir"
            @acionar="imprimir"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portaria.cracha.zpl')"
            data-testid="pt-cracha-zpl"
            @acionar="baixarZpl"
          />
        </div>
      </div>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
