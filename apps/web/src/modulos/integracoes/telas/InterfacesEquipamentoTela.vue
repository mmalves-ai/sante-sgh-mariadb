<script setup lang="ts">
// Interfaces de equipamento do laboratório (F3.5, 05-SADT linha 13): `/sadt/laboratorio/interfaces`. Uma tela só: a
// lista das interfaces com o que está pendente em cada uma (pedidos na fila, resultados com erro, falta de códigos), o
// cadastro da interface com o equipamento no mesmo formulário (a regra do domínio confere na hora, campo a campo, a
// mesma que a API aplica), os códigos de exames e de analitos no equipamento e as mensagens trafegadas, com o
// reprocessamento da que falhou. Nada se apaga: interface e código saem de uso por inativação.
import {
  conferirInterface,
  type PadraoMensagemModelo,
  type ProtocoloInterface,
  type SentidoInterface,
} from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa, novaChave } from '../../exames/api-exames.js';
import {
  type InterfaceEquipamentoLida,
  lerApoioInterfaces,
  lerCatalogoDoDePara,
  lerDeParaEquipamento,
  lerMensagensEquipamento,
  listarInterfacesEquipamento,
  reprocessarMensagemEquipamento,
  salvarDeParaAnalito,
  salvarDeParaExame,
  salvarInterfaceEquipamento,
} from '../api-interfaces-equipamento.js';

const { t, te } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({
  queryKey: ['sadt', 'interfaces-equipamento'],
  queryFn: listarInterfacesEquipamento,
});
const apoio = useQuery({
  queryKey: ['sadt', 'interfaces-equipamento', 'apoio'],
  queryFn: lerApoioInterfaces,
});
const catalogo = useQuery({ queryKey: ['sadt', 'catalogo', 'opcoes'], queryFn: lerCatalogoDoDePara });

const selecionada = ref<number | null>(null);
const aberta = computed(() => lista.data.value?.find((i) => i.id === selecionada.value) ?? null);
const dePara = useQuery({
  queryKey: computed(() => ['sadt', 'interfaces-equipamento', selecionada.value, 'de-para']),
  queryFn: () => lerDeParaEquipamento(selecionada.value!),
  enabled: computed(() => selecionada.value !== null && aberta.value?.equipamento != null),
});
const mensagens = useQuery({
  queryKey: computed(() => ['sadt', 'interfaces-equipamento', selecionada.value, 'mensagens']),
  queryFn: () => lerMensagensEquipamento(selecionada.value!),
  enabled: computed(() => selecionada.value !== null),
});

const opcoesDe = (xs: readonly { id: number; nome: string }[] | undefined, vazio: string) => [
  { valor: '', rotulo: vazio },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const modelos = computed(() => opcoesDe(apoio.data.value?.modelos, t('integracoes.interfaces.escolha')));
const setores = computed(() => opcoesDe(apoio.data.value?.setores, t('integracoes.interfaces.escolha')));
const protocolos = computed(() =>
  (apoio.data.value?.protocolos ?? []).map((p) => ({
    valor: p,
    rotulo: te(`integracoes.interfaces.protocolos.${p}`) ? t(`integracoes.interfaces.protocolos.${p}`) : p,
  })),
);
const sentidos = computed(() =>
  (['bidirecional', 'unidirecional'] as const).map((s) => ({
    valor: s,
    rotulo: t(`integracoes.interfaces.sentidos.${s}`),
  })),
);
const equipamentos = computed(() => {
  const vistos = new Map<number, string>();
  for (const i of lista.data.value ?? [])
    if (i.equipamento) vistos.set(i.equipamento.id, `${i.equipamento.codigo} · ${i.equipamento.descricao}`);
  return [
    { valor: '', rotulo: t('integracoes.interfaces.campos.equipamentoNovo') },
    ...[...vistos].map(([id, nome]) => ({ valor: String(id), rotulo: nome })),
  ];
});
const exames = computed(() => opcoesDe(catalogo.data.value?.exames, t('integracoes.interfaces.escolha')));
const examesOuQualquer = computed(() =>
  opcoesDe(catalogo.data.value?.exames, t('integracoes.interfaces.qualquer')),
);
const analitos = computed(() => opcoesDe(catalogo.data.value?.analitos, t('integracoes.interfaces.escolha')));

// Cadastro da interface (com o equipamento no mesmo formulário).
const vazia = () => ({
  id: null as number | null,
  versao: null as number | null,
  codigo: '',
  descricao: '',
  modelo: '',
  protocolo: 'astm',
  sentido: 'bidirecional',
  host: '',
  porta: '',
  caminhoEnvio: '',
  caminhoRetorno: '',
  enviaListaTrabalho: true,
  recebeResultado: true,
  importaComoLiberado: false,
  revisaAutomaticamente: false,
  assinaAutomaticamente: false,
  bloqueiaLaudo: false,
  ativo: true,
  equipamento: '',
  eqCodigo: '',
  eqDescricao: '',
  eqModelo: '',
  eqSerie: '',
  eqSetor: '',
});
const form = ref(vazia());
const editando = ref(false);
function novo(): void {
  form.value = vazia();
  editando.value = true;
}
function editar(i: InterfaceEquipamentoLida): void {
  form.value = {
    ...vazia(),
    id: i.id,
    versao: i.versao,
    codigo: i.codigo,
    descricao: i.descricao,
    modelo: String(i.modelo),
    protocolo: i.protocolo,
    sentido: i.sentido,
    host: i.host ?? '',
    porta: i.porta === null ? '' : String(i.porta),
    caminhoEnvio: i.caminhoEnvio ?? '',
    caminhoRetorno: i.caminhoRetorno ?? '',
    enviaListaTrabalho: i.enviaListaTrabalho,
    recebeResultado: i.recebeResultado,
    importaComoLiberado: i.importaComoLiberado,
    revisaAutomaticamente: i.revisaAutomaticamente,
    assinaAutomaticamente: i.assinaAutomaticamente,
    bloqueiaLaudo: i.bloqueiaLaudo,
    ativo: i.ativo,
    equipamento: i.equipamento ? String(i.equipamento.id) : '',
  };
  editando.value = true;
}
const textoOuNulo = (v: string) => (v.trim() === '' ? null : v.trim());
const porta = computed(() => (form.value.porta.trim() === '' ? null : Number(form.value.porta)));
// A regra do domínio confere na hora: cada problema aparece no seu campo, antes de gravar.
const problemas = computed(() => {
  const f = form.value;
  const modelo = apoio.data.value?.modelos.find((m) => String(m.id) === f.modelo) ?? null;
  const p = conferirInterface({
    codigo: f.codigo.trim(),
    descricao: f.descricao,
    protocolo: f.protocolo as ProtocoloInterface,
    sentido: f.sentido as SentidoInterface,
    padraoDoModelo: modelo ? (modelo.padrao as PadraoMensagemModelo) : null,
    sentidoDoModelo: modelo ? (modelo.sentido as SentidoInterface) : null,
    host: textoOuNulo(f.host),
    porta: porta.value,
    caminhoEnvio: textoOuNulo(f.caminhoEnvio),
    caminhoRetorno: textoOuNulo(f.caminhoRetorno),
    enviaListaTrabalho: f.enviaListaTrabalho,
    recebeResultado: f.recebeResultado,
    importaComoLiberado: f.importaComoLiberado,
    revisaAutomaticamente: f.revisaAutomaticamente,
    assinaAutomaticamente: f.assinaAutomaticamente,
    ativo: f.ativo,
  }).map((x) => ({ ...x }));
  if (f.equipamento === '') {
    if (f.eqCodigo.trim() === '' || /\s/.test(f.eqCodigo.trim()))
      p.push({ campo: 'equipamento.codigo', mensagem: t('integracoes.interfaces.campos.equipamentoCodigo') });
    if (f.eqDescricao.trim().length < 3)
      p.push({
        campo: 'equipamento.descricao',
        mensagem: t('integracoes.interfaces.campos.equipamentoDescricao'),
      });
    if (f.eqSetor === '')
      p.push({ campo: 'equipamento.setor', mensagem: t('integracoes.interfaces.campos.equipamentoSetor') });
  }
  return p;
});
const problemaDe = (campo: string) => problemas.value.find((p) => p.campo === campo)?.mensagem ?? null;
// O aviso do campo só aparece depois de o usuário começar a preencher (formulário novo não nasce vermelho).
const tocado = computed(
  () => form.value.codigo !== '' || form.value.descricao !== '' || form.value.id !== null,
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const recusa = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`integracoes.interfaces.recusas.${c}`) ? t(`integracoes.interfaces.recusas.${c}`) : null;
});
async function executar(fn: () => Promise<unknown>): Promise<boolean> {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = t('integracoes.interfaces.gravado');
    await cliente.invalidateQueries({ queryKey: ['sadt', 'interfaces-equipamento'] });
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  }
}
async function gravar(): Promise<void> {
  const f = form.value;
  const ok = await executar(() =>
    salvarInterfaceEquipamento(
      {
        id: f.id,
        versao: f.versao,
        codigo: f.codigo.trim(),
        descricao: f.descricao.trim(),
        modelo: Number(f.modelo),
        protocolo: f.protocolo,
        sentido: f.sentido,
        host: textoOuNulo(f.host),
        porta: porta.value,
        caminhoEnvio: textoOuNulo(f.caminhoEnvio),
        caminhoRetorno: textoOuNulo(f.caminhoRetorno),
        enviaListaTrabalho: f.enviaListaTrabalho,
        recebeResultado: f.recebeResultado,
        importaComoLiberado: f.importaComoLiberado,
        revisaAutomaticamente: f.revisaAutomaticamente,
        assinaAutomaticamente: f.assinaAutomaticamente,
        bloqueiaLaudo: f.bloqueiaLaudo,
        ativo: f.ativo,
        equipamento:
          f.equipamento !== ''
            ? { id: Number(f.equipamento) }
            : {
                codigo: f.eqCodigo.trim(),
                descricao: f.eqDescricao.trim(),
                modelo: textoOuNulo(f.eqModelo),
                numeroSerie: textoOuNulo(f.eqSerie),
                setor: Number(f.eqSetor),
              },
      },
      novaChave('interface.salvar'),
    ),
  );
  if (ok) editando.value = false;
}

// Códigos no equipamento.
const dpExame = ref({ exame: '', codigo: '', enviaAnalitos: false });
const dpAnalito = ref({ analito: '', exame: '', codigo: '', fator: '1', casas: '' });
const semEspaco = (v: string) => v.trim() !== '' && !/[\s|^\\&]/.test(v.trim());
const dpExameValido = computed(() => !!dpExame.value.exame && semEspaco(dpExame.value.codigo));
const fator = computed(() => Number(dpAnalito.value.fator.replace(',', '.')));
const dpAnalitoValido = computed(
  () =>
    !!dpAnalito.value.analito &&
    semEspaco(dpAnalito.value.codigo) &&
    Number.isFinite(fator.value) &&
    fator.value > 0 &&
    (dpAnalito.value.casas.trim() === '' || /^[0-6]$/.test(dpAnalito.value.casas.trim())),
);
async function incluirExame(): Promise<void> {
  const v = dpExame.value;
  const ok = await executar(() =>
    salvarDeParaExame(
      selecionada.value!,
      { exame: Number(v.exame), codigo: v.codigo.trim(), enviaAnalitos: v.enviaAnalitos },
      novaChave('interface.depara.exame'),
    ),
  );
  if (ok) dpExame.value = { exame: '', codigo: '', enviaAnalitos: false };
}
async function incluirAnalito(): Promise<void> {
  const v = dpAnalito.value;
  const ok = await executar(() =>
    salvarDeParaAnalito(
      selecionada.value!,
      {
        analito: Number(v.analito),
        exame: v.exame ? Number(v.exame) : null,
        codigo: v.codigo.trim(),
        fator: fator.value,
        casas: v.casas.trim() === '' ? null : Number(v.casas),
      },
      novaChave('interface.depara.analito'),
    ),
  );
  if (ok) dpAnalito.value = { analito: '', exame: '', codigo: '', fator: '1', casas: '' };
}
type ExameDoDePara = NonNullable<typeof dePara.data.value>['exames'][number];
type AnalitoDoDePara = NonNullable<typeof dePara.data.value>['analitos'][number];
const alternarExame = (x: ExameDoDePara) =>
  executar(() =>
    salvarDeParaExame(
      selecionada.value!,
      {
        id: x.id,
        versao: x.versao,
        exame: x.exame,
        material: x.material,
        codigo: x.codigo,
        enviaAnalitos: x.enviaAnalitos,
        ativo: !x.ativo,
      },
      novaChave('interface.depara.exame'),
    ),
  );
const alternarAnalito = (x: AnalitoDoDePara) =>
  executar(() =>
    salvarDeParaAnalito(
      selecionada.value!,
      {
        id: x.id,
        versao: x.versao,
        analito: x.analito,
        exame: x.exame,
        codigo: x.codigo,
        fator: x.fator,
        casas: x.casas,
        recebe: x.recebe,
        ativo: !x.ativo,
      },
      novaChave('interface.depara.analito'),
    ),
  );
const reprocessar = (id: number) =>
  executar(() => reprocessarMensagemEquipamento(selecionada.value!, id, novaChave('interface.reprocessar')));
const situacaoMensagem = (s: string) =>
  te(`integracoes.interfaces.mensagens.situacoes.${s}`)
    ? t(`integracoes.interfaces.mensagens.situacoes.${s}`)
    : s;
const quando = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
</script>

<template>
  <section class="interfaces" aria-labelledby="interfaces-titulo" data-testid="tela-interfaces">
    <h1 id="interfaces-titulo">{{ t('integracoes.interfaces.titulo') }}</h1>
    <p>{{ t('integracoes.interfaces.texto') }}</p>
    <p v-if="mensagem" role="status" data-testid="interfaces-mensagem">{{ mensagem }}</p>
    <div v-if="recusa" role="alert" data-testid="interfaces-recusa">
      <SanteAlerta variante="alerta" :texto="recusa" />
    </div>
    <MensagemErro v-else-if="erro" :erro="erro" />
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />

    <SanteBotao
      v-if="!editando"
      :rotulo="t('integracoes.interfaces.nova')"
      data-testid="interface-nova"
      @acionar="novo"
    />

    <fieldset v-if="editando" data-testid="interface-formulario">
      <legend>
        {{ form.id === null ? t('integracoes.interfaces.nova') : t('integracoes.interfaces.editar') }}
      </legend>
      <div class="linha">
        <label
          >{{ t('integracoes.interfaces.campos.codigo')
          }}<input v-model="form.codigo" maxlength="30" data-testid="interface-codigo" />
          <small v-if="tocado && problemaDe('codigo')" class="aviso">{{ problemaDe('codigo') }}</small>
        </label>
        <label
          >{{ t('integracoes.interfaces.campos.descricao')
          }}<input v-model="form.descricao" maxlength="150" data-testid="interface-descricao" />
          <small v-if="tocado && problemaDe('descricao')" class="aviso">{{ problemaDe('descricao') }}</small>
        </label>
        <SanteSelecao
          v-model="form.modelo"
          :rotulo="t('integracoes.interfaces.campos.modelo')"
          :opcoes="modelos"
          data-testid="interface-modelo"
        />
        <SanteSelecao
          v-model="form.protocolo"
          :rotulo="t('integracoes.interfaces.campos.protocolo')"
          :opcoes="protocolos"
          data-testid="interface-protocolo"
        />
        <SanteSelecao
          v-model="form.sentido"
          :rotulo="t('integracoes.interfaces.campos.sentido')"
          :opcoes="sentidos"
          data-testid="interface-sentido"
        />
        <label
          >{{ t('integracoes.interfaces.campos.host')
          }}<input v-model="form.host" maxlength="255" data-testid="interface-host" />
        </label>
        <label
          >{{ t('integracoes.interfaces.campos.porta')
          }}<input v-model="form.porta" inputmode="numeric" maxlength="5" data-testid="interface-porta" />
        </label>
        <label v-if="form.protocolo === 'arquivo'"
          >{{ t('integracoes.interfaces.campos.caminhoEnvio')
          }}<input v-model="form.caminhoEnvio" maxlength="255" />
        </label>
        <label v-if="form.protocolo === 'arquivo'"
          >{{ t('integracoes.interfaces.campos.caminhoRetorno')
          }}<input v-model="form.caminhoRetorno" maxlength="255" />
        </label>
      </div>
      <div class="linha">
        <label
          ><input v-model="form.enviaListaTrabalho" type="checkbox" data-testid="interface-envia" />
          {{ t('integracoes.interfaces.campos.enviaListaTrabalho') }}</label
        >
        <label
          ><input v-model="form.recebeResultado" type="checkbox" />
          {{ t('integracoes.interfaces.campos.recebeResultado') }}</label
        >
        <label
          ><input v-model="form.bloqueiaLaudo" type="checkbox" />
          {{ t('integracoes.interfaces.campos.bloqueiaLaudo') }}</label
        >
        <label
          ><input v-model="form.ativo" type="checkbox" data-testid="interface-ativo" />
          {{ t('integracoes.interfaces.campos.ativo') }}</label
        >
      </div>
      <div class="linha">
        <SanteSelecao
          v-model="form.equipamento"
          :rotulo="t('integracoes.interfaces.campos.equipamento')"
          :opcoes="equipamentos"
          data-testid="interface-equipamento"
        />
        <template v-if="form.equipamento === ''">
          <label
            >{{ t('integracoes.interfaces.campos.equipamentoCodigo')
            }}<input v-model="form.eqCodigo" maxlength="30" data-testid="equipamento-codigo"
          /></label>
          <label
            >{{ t('integracoes.interfaces.campos.equipamentoDescricao')
            }}<input v-model="form.eqDescricao" maxlength="150" data-testid="equipamento-descricao"
          /></label>
          <label
            >{{ t('integracoes.interfaces.campos.equipamentoModelo')
            }}<input v-model="form.eqModelo" maxlength="60"
          /></label>
          <label
            >{{ t('integracoes.interfaces.campos.equipamentoSerie')
            }}<input v-model="form.eqSerie" maxlength="60"
          /></label>
          <SanteSelecao
            v-model="form.eqSetor"
            :rotulo="t('integracoes.interfaces.campos.equipamentoSetor')"
            :opcoes="setores"
            data-testid="equipamento-setor"
          />
        </template>
      </div>
      <ul v-if="tocado" class="avisos" data-testid="interface-problemas">
        <li
          v-for="p in problemas.filter((x) => x.campo !== 'codigo' && x.campo !== 'descricao')"
          :key="p.campo"
          :data-campo="p.campo"
        >
          {{ p.mensagem }}
        </li>
      </ul>
      <div class="linha">
        <SanteBotao
          :rotulo="t('integracoes.interfaces.gravar')"
          :desabilitado="problemas.length > 0"
          data-testid="interface-gravar"
          @acionar="gravar"
        />
        <SanteBotao
          :rotulo="t('integracoes.interfaces.cancelar')"
          variante="secundario"
          @acionar="editando = false"
        />
      </div>
    </fieldset>

    <p v-if="lista.data.value && lista.data.value.length === 0" data-testid="interfaces-vazio">
      {{ t('integracoes.interfaces.nenhuma') }}
    </p>
    <table v-else-if="lista.data.value" data-testid="interfaces-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('integracoes.interfaces.colunas.interface') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.equipamento') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.comunicacao') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.codigos') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.fila') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.erros') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.ultimo') }}</th>
          <th scope="col">{{ t('integracoes.interfaces.colunas.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="i in lista.data.value"
          :key="i.id"
          :class="{ inativa: !i.ativo }"
          :data-testid="`interface-${i.id}`"
        >
          <td>
            {{ i.codigo }} · {{ i.descricao }}
            <span v-if="!i.ativo"> · {{ t('integracoes.interfaces.inativa') }}</span>
          </td>
          <td>{{ i.equipamento ? `${i.equipamento.descricao} (${i.equipamento.setorNome})` : '—' }}</td>
          <td>{{ i.modeloNome }} · {{ t(`integracoes.interfaces.sentidos.${i.sentido}`) }}</td>
          <td>
            <template v-if="i.examesComCodigo + i.analitosComCodigo > 0">{{
              t('integracoes.interfaces.codigosResumo', {
                exames: i.examesComCodigo,
                analitos: i.analitosComCodigo,
              })
            }}</template>
            <strong v-else :data-testid="`interface-sem-codigos-${i.id}`">{{
              t('integracoes.interfaces.semCodigos')
            }}</strong>
          </td>
          <td>{{ i.pedidosNaFila }}</td>
          <td>
            <strong v-if="i.resultadosComErro > 0" :data-testid="`interface-erros-${i.id}`">{{
              i.resultadosComErro
            }}</strong>
            <template v-else>{{ i.resultadosComErro }}</template>
          </td>
          <td>{{ quando(i.ultimoResultadoEm) }}</td>
          <td class="linha">
            <SanteBotao
              :rotulo="t('integracoes.interfaces.abrir')"
              :data-testid="`interface-abrir-${i.id}`"
              @acionar="selecionada = i.id"
            />
            <SanteBotao
              :rotulo="t('integracoes.interfaces.editar')"
              variante="secundario"
              :data-testid="`interface-editar-${i.id}`"
              @acionar="editar(i)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="aberta">
      <fieldset v-if="aberta.equipamento" data-testid="interface-de-para">
        <legend>
          {{ t('integracoes.interfaces.dePara.titulo', { nome: aberta.equipamento.descricao }) }}
        </legend>
        <h2>{{ t('integracoes.interfaces.dePara.exames') }}</h2>
        <div class="linha">
          <SanteSelecao
            v-model="dpExame.exame"
            :rotulo="t('integracoes.interfaces.dePara.exame')"
            :opcoes="exames"
            data-testid="depara-exame"
          />
          <label
            >{{ t('integracoes.interfaces.dePara.codigo')
            }}<input v-model="dpExame.codigo" maxlength="30" data-testid="depara-exame-codigo"
          /></label>
          <label
            ><input v-model="dpExame.enviaAnalitos" type="checkbox" />
            {{ t('integracoes.interfaces.dePara.enviaAnalitos') }}</label
          >
          <SanteBotao
            :rotulo="t('integracoes.interfaces.incluir')"
            :desabilitado="!dpExameValido"
            data-testid="depara-exame-incluir"
            @acionar="incluirExame"
          />
        </div>
        <p v-if="(dePara.data.value?.exames ?? []).length === 0">
          {{ t('integracoes.interfaces.dePara.nenhum') }}
        </p>
        <ul data-testid="depara-exames">
          <li
            v-for="x in dePara.data.value?.exames ?? []"
            :key="`${x.editavel}-${x.id}`"
            :class="{ inativa: !x.ativo }"
          >
            {{ x.exameNome }} · {{ x.codigo }}
            <span v-if="!x.editavel"> · {{ t('integracoes.interfaces.dePara.daCarga') }}</span>
            <SanteBotao
              v-else
              :rotulo="x.ativo ? t('integracoes.interfaces.inativar') : t('integracoes.interfaces.reativar')"
              variante="secundario"
              @acionar="alternarExame(x)"
            />
          </li>
        </ul>

        <h2>{{ t('integracoes.interfaces.dePara.analitos') }}</h2>
        <div class="linha">
          <SanteSelecao
            v-model="dpAnalito.analito"
            :rotulo="t('integracoes.interfaces.dePara.analito')"
            :opcoes="analitos"
            data-testid="depara-analito"
          />
          <SanteSelecao
            v-model="dpAnalito.exame"
            :rotulo="t('integracoes.interfaces.dePara.exameDoAnalito')"
            :opcoes="examesOuQualquer"
          />
          <label
            >{{ t('integracoes.interfaces.dePara.codigo')
            }}<input v-model="dpAnalito.codigo" maxlength="30" data-testid="depara-analito-codigo"
          /></label>
          <label
            >{{ t('integracoes.interfaces.dePara.fator')
            }}<input v-model="dpAnalito.fator" inputmode="decimal" data-testid="depara-analito-fator"
          /></label>
          <label
            >{{ t('integracoes.interfaces.dePara.casas')
            }}<input v-model="dpAnalito.casas" inputmode="numeric" maxlength="1"
          /></label>
          <SanteBotao
            :rotulo="t('integracoes.interfaces.incluir')"
            :desabilitado="!dpAnalitoValido"
            data-testid="depara-analito-incluir"
            @acionar="incluirAnalito"
          />
        </div>
        <ul data-testid="depara-analitos">
          <li v-for="x in dePara.data.value?.analitos ?? []" :key="x.id" :class="{ inativa: !x.ativo }">
            {{ x.analitoNome }} ·
            {{ t('integracoes.interfaces.dePara.resumoAnalito', { codigo: x.codigo, fator: x.fator }) }}
            <SanteBotao
              :rotulo="x.ativo ? t('integracoes.interfaces.inativar') : t('integracoes.interfaces.reativar')"
              variante="secundario"
              @acionar="alternarAnalito(x)"
            />
          </li>
        </ul>
      </fieldset>

      <fieldset data-testid="interface-mensagens">
        <legend>{{ t('integracoes.interfaces.mensagens.titulo') }}</legend>
        <p v-if="(mensagens.data.value ?? []).length === 0">
          {{ t('integracoes.interfaces.mensagens.nenhuma') }}
        </p>
        <ul>
          <li v-for="g in mensagens.data.value ?? []" :key="g.id" :data-testid="`mensagem-${g.id}`">
            {{ t(`integracoes.interfaces.mensagens.${g.direcao}`) }} · {{ g.referencia }} ·
            {{ situacaoMensagem(g.situacao) }} · {{ quando(g.processadaEm ?? g.criadaEm) }}
            <template v-if="g.erro">
              · {{ t('integracoes.interfaces.mensagens.pendencia') }}: {{ g.erro }}</template
            >
            <SanteBotao
              v-if="g.direcao === 'entrada' && (g.situacao === 'erro' || g.situacao === 'pendente')"
              :rotulo="t('integracoes.interfaces.mensagens.reprocessar')"
              :data-testid="`mensagem-reprocessar-${g.id}`"
              @acionar="reprocessar(g.id)"
            />
          </li>
        </ul>
      </fieldset>
    </template>
  </section>
</template>

<style scoped>
.interfaces {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
label {
  display: grid;
  gap: 0.25rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.5rem;
}
.inativa {
  opacity: 0.6;
}
.avisos {
  margin: 0;
}
</style>
